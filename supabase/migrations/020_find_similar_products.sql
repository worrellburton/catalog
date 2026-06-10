-- 020_find_similar_products
--
-- Product-page "Similar" rail, rebuilt on the SAME signal the feed search
-- uses: products.embedding — the 384-dim gte-small TEXT embedding of each
-- product's enriched description (material, colour, fit, occasion, …). That
-- column is ~99% populated, whereas the old similarity path keyed off
-- product_creative.embedding (512-dim Marengo visual vectors) which exist for
-- only a handful of creatives — so "Similar" was almost always cold-start
-- filler. Seeding from products.embedding gives genuine description-level
-- similarity for nearly the whole catalogue.
--
-- Isolation: this function reads ONLY public.products. It does NOT touch the
-- `search` edge function, its RPCs, or any full-text index, so the feed
-- search path is completely unaffected.
--
-- Scope: hard-gated to the seed's category (products.type) so the rail never
-- mixes garment types. Gender is intentionally NOT filtered here — the
-- consumer layer applies seed-gender (ProductPage) and shopper-gender
-- (service) scoping exactly as it does for every other rail. Only renderable
-- products are returned (is_active + a primary video) so every tile paints,
-- matching the home-feed visibility contract (one product = one video tile).
--
-- Ranking: pgvector cosine distance (<=>), nearest first. The caller applies
-- the product_similarity_threshold dial (/admin/dials) as a soft preference.

create or replace function public.find_similar_products(
  seed_id uuid,
  k integer default 12,
  seed_type text default null
)
returns table(
  id uuid,
  name text,
  brand text,
  price text,
  image_url text,
  primary_image_url text,
  primary_video_url text,
  primary_video_poster_url text,
  images jsonb,
  url text,
  type text,
  gender text,
  is_elite boolean,
  distance double precision
)
language sql
stable
as $$
  with seed as (
    select embedding, coalesce(seed_type, type) as rtype
    from public.products
    where id = seed_id
  )
  select
    p.id,
    p.name,
    p.brand,
    p.price,
    p.image_url,
    p.primary_image_url,
    p.primary_video_url,
    p.primary_video_poster_url,
    p.images,
    p.url,
    p.type,
    p.gender,
    p.is_elite,
    (p.embedding <=> s.embedding)::double precision as distance
  from public.products p, seed s
  where p.id <> seed_id
    and s.embedding is not null      -- no seed vector → no similarity signal
    and s.rtype is not null          -- no category → don't leak cross-type
    and p.embedding is not null
    and p.type = s.rtype             -- hard category gate
    and p.is_active = true
    and p.primary_video_url is not null
  order by p.embedding <=> s.embedding
  limit k;
$$;

grant execute on function public.find_similar_products(uuid, integer, text) to anon, authenticated, service_role;
