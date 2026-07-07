-- Stylist Engine (anti-repeat): give style_slot_search an exclude_ids param so a
-- re-asked occasion can skip products already shown in the thread. search_products
-- already supports exclude_ids (its 5th arg) — style_slot_search just hardcoded
-- '{}'. The new 4th param defaults to '{}', so existing 3-arg callers (the client
-- slotSearch, the style_engine path) are byte-identical; only the stylist_engine
-- dial value passes a non-empty set.
--
-- Drop-then-recreate because adding a param changes the signature (same precedent
-- as 20260707000000 dropping the 5-arg search_products).

drop function if exists public.style_slot_search(text, integer, text);

create or replace function public.style_slot_search(
  p_query text, p_k integer default 8, p_gender text default null,
  p_exclude_ids uuid[] default '{}'::uuid[]
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
    array_fill(0::real, array[384])::vector(384), p_query, p_k, p_gender, p_exclude_ids
  ) s;
$$;

grant execute on function public.style_slot_search(text, integer, text, uuid[]) to authenticated, service_role;
