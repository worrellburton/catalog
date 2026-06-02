-- 022_similarity_profile_and_rpc_v2
--
-- Durable "Similar" accuracy: a dedicated similarity signal + a clean
-- category gate, replacing the noisy "full marketing description embedding +
-- crude products.type" pair.
--
-- WHY: products.embedding is built from the enriched marketing description
-- (occasion fluff, "dishwasher safe", care text). That language makes
-- unrelated items look alike (a coffee glass ranked Tide pods 0.173 — both
-- mention household/cleaning). And products.type has a catch-all "Other"
-- bucket plus fragmentation (Shoes/Sneakers/Sandals/Boots).
--
-- WHAT:
--   • similarity_profile  — a concise, attribute-only descriptor written by
--     the enrichment pass (category · subcategory · material · colour · form),
--     NO marketing/care text. Embedded separately so search is untouched.
--   • similarity_embedding (384-dim gte-small over the profile).
--   • product_taxonomy.category — a clean, controlled category used as the gate.
--
-- The RPC prefers these when present and FALLS BACK to (products.embedding,
-- products.type) otherwise, so it keeps working unchanged until the backfill
-- populates the new columns — then auto-upgrades. products.embedding and the
-- `search` path are never touched.

alter table public.products
  add column if not exists similarity_profile      text,
  add column if not exists similarity_embedding    vector(384),
  add column if not exists similarity_embedded_at  timestamptz;

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
    select
      coalesce(p.similarity_embedding, p.embedding) as emb,
      lower(coalesce(
        nullif(p.product_taxonomy->>'category', ''),
        seed_type,
        p.type,
        ''
      )) as cat
    from public.products p
    where p.id = seed_id
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
    (coalesce(p.similarity_embedding, p.embedding) <=> s.emb)::double precision as distance
  from public.products p, seed s
  where p.id <> seed_id
    and s.emb is not null
    and s.cat <> ''
    and s.cat <> 'other'                                  -- skip catch-all
    and coalesce(p.similarity_embedding, p.embedding) is not null
    and lower(coalesce(nullif(p.product_taxonomy->>'category', ''), p.type, '')) = s.cat
    and p.is_active = true
    and p.primary_video_url is not null
  order by coalesce(p.similarity_embedding, p.embedding) <=> s.emb
  limit k;
$$;

grant execute on function public.find_similar_products(uuid, integer, text) to anon, authenticated, service_role;
