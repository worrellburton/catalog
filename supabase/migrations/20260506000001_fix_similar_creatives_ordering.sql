-- 20260506000001: Fix find_similar_creatives ordering + cold-start fallback
--
-- Bug 1 (critical): DISTINCT ON forces ORDER BY pc.product_id, which means
-- LIMIT k returns k products sorted by UUID — not by similarity score.
-- Fix: wrap the DISTINCT ON in a subquery so the outer query can
-- ORDER BY distance before applying LIMIT k.
--
-- Bug 2 (high): cold-start returned same-brand products, which pickFrom()
-- always strips — guaranteed empty rail. Fix: return cross-brand popular
-- creatives scoped to the seed product's type. If the type is so sparse
-- that no other creatives exist in it (e.g. only 1 Decor product), relax
-- the type filter so the rail always shows something.

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
  has_type_match bool := false;
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
    -- Check whether any same-type cross-brand creatives exist. If so, scope
    -- the results to that type (sweater → Tops only). If the category is
    -- sparse and nothing else exists (e.g. only 1 Decor creative), relax
    -- the type filter so the rail isn't empty.
    if seed_type is not null then
      select exists(
        select 1
        from product_creative pc2
        join products p2 on p2.id = pc2.product_id
        where pc2.id <> seed_id
          and pc2.status = 'live'
          and pc2.video_url is not null
          and (seed_brand is null or p2.brand <> seed_brand)
          and p2.type = seed_type
      ) into has_type_match;
    end if;

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
        and (not has_type_match or p.type = seed_type)
      order by pc.product_id, pc.impressions desc, pc.created_at desc
      limit k;
  end if;
end;
$$;

grant execute on function find_similar_creatives(uuid, int) to anon, authenticated;
