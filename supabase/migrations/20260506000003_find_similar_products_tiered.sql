-- 20260506000003: tier the find_similar_products RPC + add smoke-test helpers
--
-- Problem: a hard p.type = seed_type filter is too brittle for the
-- catalog's sparse and inconsistent taxonomy:
--   - Plants split across "Other" and "Decor"
--   - "Cotton Cashmere Short Sleeve Tee" mis-typed as "Shorts"
--   - 6 active products with type IS NULL
--   - Many types have <4 active products with creatives
--
-- Result: rails come up empty or wrong even though semantically similar
-- products exist.
--
-- Fix: tiered ordering. Tier 0 = same type (preferred), tier 1 = any
-- other type (fills the rest by embedding distance). Sorting first by
-- tier then by distance keeps strict-type matches at the top while
-- guaranteeing the rail is never empty when there are semantic
-- neighbors anywhere in the catalog.

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
    -- Step 1: rank every eligible candidate (one per product) by
    --         semantic distance.
    -- Step 2: tag each row's tier — 0 if it matches seed.type, else 1.
    -- Step 3: order by (tier, distance) so same-type wins when present
    --         but cross-type fills the remainder. seed.type IS NULL
    --         collapses to tier 0 for everyone (no preference).
    return query
      select ranked.id,
             ranked.product_id,
             ranked.video_url,
             ranked.thumbnail_url,
             ranked.product_name,
             ranked.product_brand,
             ranked.product_image_url,
             ranked.product_price,
             ranked.product_url,
             ranked.product_type,
             ranked.product_gender,
             ranked.distance
      from (
        select distinct on (pc.product_id)
          pc.id,
          pc.product_id,
          pc.video_url,
          pc.thumbnail_url,
          p.name      as product_name,
          p.brand     as product_brand,
          p.image_url as product_image_url,
          p.price     as product_price,
          p.url       as product_url,
          p.type      as product_type,
          p.gender    as product_gender,
          (p.embedding <=> seed_embedding)::double precision as distance,
          case
            when seed_type is null then 0
            when p.type = seed_type then 0
            else 1
          end as tier
        from product_creative pc
        join products p on p.id = pc.product_id
        where pc.product_id <> seed_product_id
          and pc.status = 'live'
          and pc.video_url is not null
          and p.is_active = true
          and p.embedding is not null
        order by pc.product_id, p.embedding <=> seed_embedding
      ) ranked
      order by ranked.tier, ranked.distance
      limit k;
  else
    -- ── Cold-start (seed has no embedding) ───────────────────────────
    -- Same tiering by type, but ranked by impressions (popularity) since
    -- we have no semantic signal. Excludes same-brand because the client
    -- always filters same-brand from the rail anyway.
    return query
      select ranked.id,
             ranked.product_id,
             ranked.video_url,
             ranked.thumbnail_url,
             ranked.product_name,
             ranked.product_brand,
             ranked.product_image_url,
             ranked.product_price,
             ranked.product_url,
             ranked.product_type,
             ranked.product_gender,
             ranked.distance
      from (
        select distinct on (pc.product_id)
          pc.id,
          pc.product_id,
          pc.video_url,
          pc.thumbnail_url,
          p.name      as product_name,
          p.brand     as product_brand,
          p.image_url as product_image_url,
          p.price     as product_price,
          p.url       as product_url,
          p.type      as product_type,
          p.gender    as product_gender,
          1.0::double precision as distance,
          case
            when seed_type is null then 0
            when p.type = seed_type then 0
            else 1
          end as tier,
          pc.impressions,
          pc.created_at
        from product_creative pc
        join products p on p.id = pc.product_id
        where pc.product_id <> seed_product_id
          and pc.status = 'live'
          and pc.video_url is not null
          and p.is_active = true
          and (seed_brand is null or p.brand <> seed_brand)
        order by pc.product_id, pc.impressions desc, pc.created_at desc
      ) ranked
      order by ranked.tier, ranked.impressions desc, ranked.created_at desc
      limit k;
  end if;
end;
$$;

grant execute on function find_similar_products(uuid, int) to anon, authenticated;
