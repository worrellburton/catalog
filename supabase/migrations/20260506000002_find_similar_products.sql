-- 20260506000002: find_similar_products — type-aware product similarity
--
-- Problem: find_similar_creatives uses Marengo 3.0 visual embeddings,
-- which cluster by visual style (dark images, lifestyle shots, etc.)
-- not by product category. A black sweater seed returns plants and
-- hats because they share visual aesthetics. There is no category
-- gate anywhere in the rail's pipeline.
--
-- Fix: a new RPC seeded by product_id that uses the SAME mechanism as
-- the consumer search bar — products.embedding (384-dim gte-small text
-- embedding from name/brand/type/description). This naturally clusters
-- by category because the embedding source text encodes category-rich
-- vocabulary. We add a hard filter on products.type so a "Top" seed
-- only returns other "Top" rows, a "Shoes" seed only returns shoes,
-- etc. Works across all product categories (fashion, beauty, home,
-- tech, lifestyle), not just apparel.
--
-- Return shape carries full product hydration (image_url, price, url,
-- type, gender) so the client doesn't need a follow-up round-trip.

create or replace function find_similar_products(
  seed_product_id uuid,
  k               int default 12
) returns table (
  id                uuid,
  product_id        uuid,
  video_url         text,
  thumbnail_url     text,
  product_name      text,
  product_brand     text,
  product_image_url text,
  product_price     text,
  product_url       text,
  product_type      text,
  product_gender    text,
  distance          double precision
) language plpgsql stable as $$
declare
  seed_embedding vector(384);
  seed_type      text;
  seed_brand     text;
begin
  select p.embedding, p.type, p.brand
    into seed_embedding, seed_type, seed_brand
    from products p
   where p.id = seed_product_id;

  if seed_embedding is not null then
    -- ── Embedding path ───────────────────────────────────────────────
    -- DISTINCT ON picks the nearest creative per product; outer ORDER BY
    -- ensures LIMIT k keeps the k most similar (not the k earliest UUIDs).
    -- Hard type filter when seed has a type — keeps the rail on-category.
    return query
      select ranked.*
      from (
        select distinct on (pc.product_id)
          pc.id,
          pc.product_id,
          pc.video_url,
          pc.thumbnail_url,
          p.name        as product_name,
          p.brand       as product_brand,
          p.image_url   as product_image_url,
          p.price       as product_price,
          p.url         as product_url,
          p.type        as product_type,
          p.gender      as product_gender,
          (p.embedding <=> seed_embedding)::double precision as distance
        from product_creative pc
        join products p on p.id = pc.product_id
        where pc.product_id <> seed_product_id
          and pc.status = 'live'
          and pc.video_url is not null
          and p.is_active = true
          and p.embedding is not null
          and (seed_type is null or p.type = seed_type)
        order by pc.product_id, p.embedding <=> seed_embedding
      ) ranked
      order by ranked.distance
      limit k;
  else
    -- ── Cold-start (seed has no embedding) ───────────────────────────
    -- Same-type, popular (impressions desc). Excludes same-brand because
    -- the client always strips same-brand from the rail anyway.
    return query
      select distinct on (pc.product_id)
        pc.id,
        pc.product_id,
        pc.video_url,
        pc.thumbnail_url,
        p.name        as product_name,
        p.brand       as product_brand,
        p.image_url   as product_image_url,
        p.price       as product_price,
        p.url         as product_url,
        p.type        as product_type,
        p.gender      as product_gender,
        1.0::double precision as distance
      from product_creative pc
      join products p on p.id = pc.product_id
      where pc.product_id <> seed_product_id
        and pc.status = 'live'
        and pc.video_url is not null
        and p.is_active = true
        and (seed_type is null or p.type = seed_type)
        and (seed_brand is null or p.brand <> seed_brand)
      order by pc.product_id, pc.impressions desc, pc.created_at desc
      limit k;
  end if;
end;
$$;

grant execute on function find_similar_products(uuid, int) to anon, authenticated;
