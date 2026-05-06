-- 20260506000001: Fix find_similar_creatives ordering + cold-start fallback
--
-- Bug 1 (critical): DISTINCT ON forces ORDER BY pc.product_id, which means
-- LIMIT k returns k products sorted by UUID — not by similarity score.
-- Rows closest to the seed product can be discarded because their UUIDs
-- sort late. Fix: wrap the DISTINCT ON in a subquery so the outer query
-- can ORDER BY distance before applying LIMIT k.
--
-- Bug 2 (high): the cold-start fallback (no embedding) returns same-brand
-- products. But pickFrom() in ProductPage always strips same-brand items,
-- so that fallback is guaranteed to produce an empty rail, which then
-- shows the unrelated popular feed instead. Fix: cold-start returns
-- cross-brand creatives ordered by impressions desc (popular) so the
-- client filter has something useful to work with.

create or replace function find_similar_creatives(
  seed_id uuid,
  k       int default 12
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
begin
  select pc.embedding, p.brand
    into seed_embedding, seed_brand
    from product_creative pc
    join products p on p.id = pc.product_id
   where pc.id = seed_id;

  if seed_embedding is not null then
    -- ── Embedding path ────────────────────────────────────────────────────
    -- Inner query: DISTINCT ON picks the nearest creative per product.
    -- ORDER BY must include pc.product_id first (required by DISTINCT ON).
    -- Outer query: re-sorts the deduped rows by distance so LIMIT k keeps
    -- the k most similar products, not the k with earliest UUIDs.
    return query
      select ranked.*
      from (
        select distinct on (pc.product_id)
          pc.id,
          pc.product_id,
          pc.video_url,
          pc.thumbnail_url,
          p.name  as product_name,
          p.brand as product_brand,
          (pc.embedding <=> seed_embedding)::double precision as distance
        from product_creative pc
        join products p on p.id = pc.product_id
        where pc.id <> seed_id
          and pc.status = 'live'
          and pc.video_url is not null
          and pc.embedding is not null
        order by pc.product_id, pc.embedding <=> seed_embedding
      ) ranked
      order by ranked.distance
      limit k;
  else
    -- ── Cold-start path (no embedding yet) ───────────────────────────────
    -- Previous version returned same-brand products, but the client always
    -- filters same-brand out, producing an empty rail. Return cross-brand
    -- popular creatives instead so the rail shows variety while the
    -- embedding pipeline catches up.
    return query
      select distinct on (pc.product_id)
        pc.id,
        pc.product_id,
        pc.video_url,
        pc.thumbnail_url,
        p.name  as product_name,
        p.brand as product_brand,
        1.0::double precision as distance
      from product_creative pc
      join products p on p.id = pc.product_id
      where pc.id <> seed_id
        and pc.status = 'live'
        and pc.video_url is not null
        and pc.embedding is not null
        and (seed_brand is null or p.brand <> seed_brand)
      order by pc.product_id, pc.impressions desc, pc.created_at desc
      limit k;
  end if;
end;
$$;

grant execute on function find_similar_creatives(uuid, int) to anon, authenticated;
