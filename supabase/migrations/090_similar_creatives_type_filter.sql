-- migration 090: type-scoped "more like this" rail
--
-- Problem: find_similar_creatives had no product-type filter, so opening a
-- t-shirt showed plants and shorts in the rail. Only 3/34 live creatives have
-- visual embeddings, so 31/34 hit the cold-start fallback (same brand →
-- newest). The fallback was the primary source of irrelevant suggestions.
--
-- Fix: add optional seed_type param. Both the vector path and the cold-start
-- fallback now apply a two-tier strategy:
--   Tier 1: restrict candidates to the same product type. If ≥ 5 results → use them.
--   Tier 2: no type filter (current behaviour) — used only when type is NULL
--           or there are fewer than 5 same-type candidates.
--
-- seed_type is nullable with DEFAULT NULL so existing callers continue to
-- work unchanged (old behaviour as fallback). When the client passes
-- product.type the RPC uses that; otherwise it reads p.type from the products
-- join on the seed row.

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
  typed_count    int;
begin
  -- Read seed's visual embedding, brand, and type.
  -- seed_type param takes priority over the stored products.type value.
  select pc.embedding, p.brand, coalesce(seed_type, p.type)
    into seed_embedding, seed_brand, resolved_type
    from product_creative pc
    join products p on p.id = pc.product_id
   where pc.id = seed_id;

  -- ── Vector path (seed has a Marengo/TwelveLabs embedding) ───────────────
  if seed_embedding is not null then

    if resolved_type is not null then
      -- Tier 1: type-scoped cosine similarity
      get diagnostics typed_count = row_count;  -- reset counter
      select count(distinct pc.product_id)
        into typed_count
        from product_creative pc
        join products p on p.id = pc.product_id
       where pc.id <> seed_id
         and pc.status = 'live'
         and pc.video_url is not null
         and pc.embedding is not null
         and p.type = resolved_type;

      if typed_count >= 5 then
        return query
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
           and p.type = resolved_type
         order by pc.product_id, pc.embedding <=> seed_embedding
         limit k;
        return;
      end if;
    end if;

    -- Tier 2: full visual similarity, no type restriction
    return query
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
     order by pc.product_id, pc.embedding <=> seed_embedding
     limit k;

  -- ── Cold-start fallback (no Marengo embedding yet) ──────────────────────
  else

    if resolved_type is not null then
      -- Tier 1: same type, newest first (cross-brand for variety)
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

-- Drop the old 2-arg overload from migration 049 to avoid ambiguity.
-- The new 3-arg function with seed_type DEFAULT NULL handles both call patterns.
drop function if exists find_similar_creatives(uuid, int);

grant execute on function find_similar_creatives(uuid, int, text) to anon, authenticated;
