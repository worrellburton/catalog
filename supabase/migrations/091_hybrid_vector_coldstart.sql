-- migration 091: hybrid vector + cold-start for symmetric "more like this"
--
-- Problem: when seed A has an embedding and seed B does not:
--   • Opening B (no embedding) → cold-start path → finds A (live, same type) ✓
--   • Opening A (has embedding) → vector path → requires pc.embedding IS NOT NULL
--     on result rows → B is invisible → A shows nothing in "More like this" ✗
--
-- This asymmetry means two related items only show each other one-way.
--
-- Fix: replace the two-tier vector path with a hybrid approach:
--   Step 1: cosine-rank all live creatives that HAVE embeddings (type-scoped).
--   Step 2: supplement with same-type creatives WITHOUT embeddings to fill k.
--
-- Cold-start path (seed has no embedding) is unchanged — it already works
-- correctly because it uses a date-sorted query with no embedding requirement.

create or replace function find_similar_creatives(
  seed_id   uuid,
  k         int  default 12,
  seed_type text default null
) returns table (
  id            uuid,
  product_id    uuid,
  video_url     text,
  thumbnail_url text,
  product_name  text,
  product_brand text,
  distance      double precision
) language plpgsql stable as $$
declare
  seed_embedding vector(512);
  seed_brand     text;
  resolved_type  text;
begin
  -- Read seed's visual embedding, brand, and type.
  -- seed_type param takes priority over the stored products.type value.
  select pc.embedding, p.brand, coalesce(seed_type, p.type)
    into seed_embedding, seed_brand, resolved_type
    from product_creative pc
    join products p on p.id = pc.product_id
   where pc.id = seed_id;

  -- ── Vector path (seed has a Marengo/TwelveLabs embedding) ───────────────
  -- Hybrid: vector-ranked results first, then supplement with same-type items
  -- that have no embedding so products without embeddings stay discoverable.
  if seed_embedding is not null then

    return query
      with vector_results as (
        -- Best visually-similar items that also have embeddings (type-scoped).
        select distinct on (pc.product_id)
          pc.id, pc.product_id, pc.video_url, pc.thumbnail_url,
          p.name, p.brand,
          (pc.embedding <=> seed_embedding)::double precision as distance
        from product_creative pc
        join products p on p.id = pc.product_id
       where pc.id <> seed_id
         and pc.status = 'live'
         and pc.video_url is not null
         and pc.embedding is not null
         and (resolved_type is null or p.type = resolved_type)
       order by pc.product_id, pc.embedding <=> seed_embedding
      ),
      coldstart_supplement as (
        -- Same-type items with no embedding, ordered newest-first.
        -- Excluded if already returned by vector_results.
        select distinct on (pc.product_id)
          pc.id, pc.product_id, pc.video_url, pc.thumbnail_url,
          p.name, p.brand,
          1.0::double precision as distance
        from product_creative pc
        join products p on p.id = pc.product_id
       where pc.id <> seed_id
         and pc.status = 'live'
         and pc.video_url is not null
         and pc.embedding is null
         and (resolved_type is null or p.type = resolved_type)
         and pc.product_id not in (select vr.product_id from vector_results vr)
       order by pc.product_id, pc.created_at desc
      )
      -- Vector results rank first (real distances < 1.0 typically);
      -- cold-start supplements fill remaining slots at distance = 1.0.
      select * from vector_results
      union all
      select * from coldstart_supplement
      order by distance
      limit k;

    return;

  -- ── Cold-start fallback (no Marengo embedding on seed) ──────────────────
  else

    if resolved_type is not null then
      -- Tier 1: same type, newest first (cross-brand for variety)
      declare
        typed_count int;
      begin
        select count(distinct pc.product_id)
          into typed_count
          from product_creative pc
          join products p on p.id = pc.product_id
         where pc.id <> seed_id
           and pc.status = 'live'
           and pc.video_url is not null
           and p.type = resolved_type;

        if typed_count >= 5 then
          return query
            select distinct on (pc.product_id)
              pc.id, pc.product_id, pc.video_url, pc.thumbnail_url,
              p.name, p.brand,
              1.0::double precision as distance
            from product_creative pc
            join products p on p.id = pc.product_id
           where pc.id <> seed_id
             and pc.status = 'live'
             and pc.video_url is not null
             and p.type = resolved_type
           order by pc.product_id, pc.created_at desc
           limit k;
          return;
        end if;
      end;
    end if;

    -- Tier 2: no type filter, same brand (original behaviour)
    return query
      select distinct on (pc.product_id)
        pc.id, pc.product_id, pc.video_url, pc.thumbnail_url,
        p.name, p.brand,
        1.0::double precision as distance
      from product_creative pc
      join products p on p.id = pc.product_id
     where pc.id <> seed_id
       and pc.status = 'live'
       and pc.video_url is not null
       and (p.brand = seed_brand or seed_brand is null)
     order by pc.product_id, pc.created_at desc
     limit k;

  end if;
end;
$$;

grant execute on function find_similar_creatives(uuid, int, text) to anon, authenticated;
