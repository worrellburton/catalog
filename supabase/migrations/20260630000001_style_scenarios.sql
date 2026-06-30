-- Style Scenarios cockpit (admin/seeding → Styling tab). Two small pieces:
--
-- 1) seed_targets.intent jsonb — structured styling intent for kind='scenario'
--    rows (occasion, gender, formality 0-5, season, slots[], palette), written
--    by the generate-style-scenarios edge fn and read by the style-engine
--    simulation. Demand (keyword/manual) targets leave it null.
--
-- 2) style_slot_search(query, k, gender) — a thin wrapper over search_products
--    that passes a neutral zero 384-vector, so the style-engine does
--    occasion-aware PER-SLOT retrieval (the CATEGORY route ranks BM25 over
--    name + occasion text and ignores the embedding when the query names a
--    garment noun) without threading a pgvector arg through PostgREST.
--
-- See docs/CATALOG_SEEDING.md (Styling scenarios cockpit).

alter table public.seed_targets
  add column if not exists intent jsonb;

create or replace function public.style_slot_search(
  p_query text, p_k integer default 8, p_gender text default null
)
returns table(
  product_id uuid, product_name text, product_brand text, product_price text,
  product_image_url text, product_url text, product_gender text, product_type text,
  score double precision
)
language sql stable as $$
  select s.product_id, s.product_name, s.product_brand, s.product_price,
         s.product_image_url, s.product_url, s.product_gender, s.product_type, s.score
  from public.search_products(
    array_fill(0::real, array[384])::vector(384), p_query, p_k, p_gender, '{}'::uuid[]
  ) s;
$$;

grant execute on function public.style_slot_search(text, integer, text) to authenticated, service_role;
