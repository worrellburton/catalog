-- 20260506000001: Fix find_similar_creatives ordering + cold-start fallback
--
-- Bug 1 (critical): DISTINCT ON forces ORDER BY pc.product_id, which means
-- LIMIT k returns k products sorted by UUID — not by similarity score.
-- Fix: wrap the DISTINCT ON in a subquery so the outer query can
-- ORDER BY distance before applying LIMIT k.
--
-- Bug 2 (high): cold-start returned same-brand products, which the client
-- always strips — guaranteed empty rail. Fix: return cross-brand popular
-- creatives, always scoped to the seed product's type. If nothing comes
-- back (e.g. only one brand makes Decor items), the section hides on the
-- client rather than falling back to unrelated fashion creatives.

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
  seed_type      text;
begin
  select pc.embedding, p.brand, p.type
    into seed_embedding, seed_brand, seed_type
    from product_creative pc
    join products p on p.id = pc.product_id
   where pc.id = seed_id;

  if seed_embedding is not null then
    -- ── Embedding path ────────────────────────────────────────────────────
    -- Inner DISTINCT ON picks the nearest creative per product.
    -- Outer ORDER BY distance ensures LIMIT k keeps the k most similar,
    -- not the k with earliest-sorting UUIDs.
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
    -- Always scope to the seed product's type. If no cross-brand same-type
    -- creatives exist (e.g. all Decor items are from one brand), 0 rows are
    -- returned and the client hides the section entirely.
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
        and (seed_brand is null or p.brand <> seed_brand)
        and (seed_type is null or p.type = seed_type)
      order by pc.product_id, pc.impressions desc, pc.created_at desc
      limit k;
  end if;
end;
$$;

grant execute on function find_similar_creatives(uuid, int) to anon, authenticated;
