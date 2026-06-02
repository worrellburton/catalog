-- 021_similar_skip_catchall_type
--
-- Quick-mitigation for the product-page "Similar" rail: do not run
-- embedding similarity when the seed's category is the non-discriminative
-- catch-all bucket "Other". That bucket lumps unrelated SKUs together
-- (e.g. coffee glasses + laundry detergent), so a type-gated match there is
-- meaningless and the description embedding pulls in tangential items
-- (a glass → Tide pods, both sharing "dishwasher / laundry / cleaning"
-- language). Returning nothing lets the consumer's "Popular" fallback fill
-- instead of showing an obviously-wrong similar.
--
-- null types are already excluded (s.rtype is not null below). Real but
-- small categories (Decor, Book, Haircare, …) are intentionally kept — a
-- book IS similar to other books. The durable fix is a dedicated similarity
-- profile + proper sub-category gate; this just stops the embarrassing case
-- until that lands.

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
    and s.embedding is not null
    and s.rtype is not null
    and lower(s.rtype) <> 'other'   -- skip the catch-all bucket
    and p.embedding is not null
    and p.type = s.rtype
    and p.is_active = true
    and p.primary_video_url is not null
  order by p.embedding <=> s.embedding
  limit k;
$$;

grant execute on function public.find_similar_products(uuid, integer, text) to anon, authenticated, service_role;
