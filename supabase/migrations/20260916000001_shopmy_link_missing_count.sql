-- Fix two defects in shopmy_link_creator_products found in review of
-- 20260916000000:
--
-- 1. `missing` conflated "not in the catalog" with "duplicate URL within
--    this batch". v_seen was jsonb_array_length(rows) - every element,
--    duplicates included - while v_linked counts rows AFTER the `distinct
--    on (normalize_product_url(...))` collapse in the `incoming` CTE. A
--    batch pinning the same product twice (routine ShopMy case: one
--    product in two collections) reported {"linked": 1, "missing": 1} even
--    though the one distinct URL resolved successfully. Fix: count v_seen
--    over DISTINCT normalised URLs, the same basis v_linked is measured on,
--    so `missing` counts only URLs with no matching products row.
--
-- 2. A NULL `rows` bypassed the type guard. jsonb_typeof(NULL) is NULL, so
--    `NULL <> 'array'` is NULL, and PL/pgSQL treats a NULL IF condition as
--    false - the exception never raised and the function returned
--    {"linked": 0, "missing": null}. Fix: explicit `rows is null or ...`.
--
-- Do NOT edit 20260916000000_creator_products.sql - it is already applied.
-- This migration create-or-replaces the same function; every other line of
-- the body (including the revoke/grant) is carried forward unchanged.

create or replace function public.shopmy_link_creator_products(
  p_handle text,
  rows     jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_linked  int := 0;
  v_seen    int := 0;
begin
  if rows is null or jsonb_typeof(rows) <> 'array' then
    raise exception 'rows must be a jsonb array';
  end if;

  -- Measured on the same basis as v_linked (post-dedup), so `missing` counts
  -- only URLs with no matching products row. Counting raw array elements here
  -- would report a within-batch duplicate - one product pinned into two
  -- collections, which is routine - as if the product were absent.
  select count(*) into v_seen
    from (select distinct public.normalize_product_url(e->>'url')
            from jsonb_array_elements(rows) as e) t;

  with incoming as (
    select distinct on (public.normalize_product_url(e->>'url'))
      public.normalize_product_url(e->>'url') as nurl,
      (e->>'pin_id')::bigint                  as pin_id,
      e->>'affiliate_url'                     as affiliate_url,
      e->>'collection_name'                   as collection_name,
      e->>'section_name'                      as section_name,
      coalesce((e->>'sort_order')::int, 0)    as sort_order
    from jsonb_array_elements(rows) with ordinality as t(e, ord)
    order by public.normalize_product_url(e->>'url'), ord
  ),
  resolved as (
    select p.id as product_id, i.*
      from incoming i
      join public.products p
        on public.normalize_product_url(p.url) = i.nurl
  ),
  upserted as (
    insert into public.creator_products
      (creator_handle, product_id, source, shopmy_pin_id, affiliate_url,
       collection_name, section_name, sort_order)
    select p_handle, r.product_id, 'shopmy', r.pin_id, r.affiliate_url,
           r.collection_name, r.section_name, r.sort_order
      from resolved r
    on conflict (creator_handle, product_id) do update set
      shopmy_pin_id   = excluded.shopmy_pin_id,
      affiliate_url   = excluded.affiliate_url,
      collection_name = excluded.collection_name,
      section_name    = excluded.section_name,
      sort_order      = excluded.sort_order
    returning 1
  )
  select count(*) into v_linked from upserted;

  return jsonb_build_object('linked', v_linked, 'missing', v_seen - v_linked);
end $$;

revoke all on function public.shopmy_link_creator_products(text, jsonb) from public, anon, authenticated;
grant execute on function public.shopmy_link_creator_products(text, jsonb) to service_role;
