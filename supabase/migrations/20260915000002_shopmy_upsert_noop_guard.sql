-- Guard shopmy_upsert_batch's merge path against re-firing the trigger
-- fan-out (trg_products_auto_verify_image, trg_products_auto_embed,
-- catalog_assign_product_trg) on a true no-op.
--
-- Postgres fires `UPDATE OF <col>` triggers based on a column's PRESENCE in
-- the DO UPDATE's SET list, not on whether its value actually changes. The
-- original 20260915000001 migration's SET list always names every mapped
-- column, so re-running an already-ingested shop re-fires the full fan-out
-- for every row even when every coalesce() resolves to the value already
-- stored - ~1,270 edge invocations / ~850 Anthropic calls for a 424-pin
-- shop, against an idempotent re-run that should cost nothing. Idempotent
-- re-runs are the normal operating mode (retrying a partially-failed run,
-- re-syncing a shop later).
--
-- Fix: add a WHERE clause to the ON CONFLICT DO UPDATE that mirrors each SET
-- expression - the row is only touched (and its triggers only fire) when at
-- least one column would actually end up holding a different value than it
-- already does. A DO UPDATE ... WHERE <false> behaves like DO NOTHING for
-- that row (no RETURNING row, no trigger), which is exactly what an
-- identical-pin re-run should do.
--
-- Do NOT edit 20260915000001_shopmy_upsert.sql - it is already applied to
-- production. This migration create-or-replaces the same function.
--
-- Side effect: `merged` in the run summary now counts only rows that
-- genuinely changed something, not every conflicting row. That is the more
-- honest number - a no-op merge was never really a merge.

create or replace function public.shopmy_upsert_batch(rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inserted int := 0;
  v_merged   int := 0;
begin
  if jsonb_typeof(rows) <> 'array' then
    raise exception 'rows must be a jsonb array';
  end if;
  if jsonb_array_length(rows) > 25 then
    raise exception 'batch too large (% rows, max 25) - see the fan-out note in the spec',
      jsonb_array_length(rows);
  end if;

  -- Dedup WITHIN the batch, on the same key the index uses. Postgres raises
  -- "ON CONFLICT DO UPDATE command cannot affect row a second time" if one
  -- statement touches the same row twice, which would abort the whole batch
  -- of 25 over a single duplicate. Two pins of the same product differing
  -- only in utm_* is routine in affiliate data, so this is expected input,
  -- not an edge case. Dedup must live here, not in the caller: only SQL has
  -- normalize_product_url, and a JS approximation would drift from the index.
  -- `ord` keeps the first occurrence in array order, deterministically.
  with incoming as (
    select distinct on (public.normalize_product_url(e->>'url'))
      e->>'url'            as url,
      e->>'name'           as name,
      e->>'brand'          as brand,
      e->>'price'          as price,
      e->>'currency'       as currency,
      e->>'type'           as type,
      e->>'image_url'      as image_url,
      e->'images'          as images,
      e->'raw_data'        as raw_data
    from jsonb_array_elements(rows) with ordinality as t(e, ord)
    order by public.normalize_product_url(e->>'url'), ord
  ),
  ins as (
    insert into public.products
      (url, name, brand, price, currency, type, image_url, images,
       raw_data, source, scrape_status, scraped_at, is_active, gender)
    select i.url, i.name, i.brand, i.price, i.currency, i.type, i.image_url, i.images,
           i.raw_data, 'shopmy', 'done', now(), false, null
      from incoming i
    on conflict (public.normalize_product_url(url)) where url is not null
    do update set
      name        = coalesce(public.products.name,      excluded.name),
      brand       = coalesce(public.products.brand,     excluded.brand),
      price       = coalesce(public.products.price,     excluded.price),
      currency    = coalesce(public.products.currency,  excluded.currency),
      type        = coalesce(public.products.type,      excluded.type),
      image_url   = coalesce(public.products.image_url, excluded.image_url),
      images      = case
                      when public.products.images is null
                        or jsonb_array_length(public.products.images) = 0
                      then excluded.images else public.products.images end,
      raw_data    = coalesce(public.products.raw_data, '{}'::jsonb)
                    || jsonb_build_object('shopmy', excluded.raw_data->'shopmy')
    -- NO-OP GUARD: mirrors every expression above. Skip the row (and its
    -- triggers) unless at least one of them would actually produce a new
    -- value. Verified 2026-09-15 against a literal VALUES fixture covering:
    -- identical rerun (skip), filling previously-null fields (update),
    -- empty->filled images (update), a different pin merging onto the same
    -- product (update - new provenance), and a real-scrape row gaining its
    -- first shopmy provenance (update).
    where
         public.products.name        is distinct from coalesce(public.products.name,      excluded.name)
      or public.products.brand       is distinct from coalesce(public.products.brand,     excluded.brand)
      or public.products.price       is distinct from coalesce(public.products.price,     excluded.price)
      or public.products.currency    is distinct from coalesce(public.products.currency,  excluded.currency)
      or public.products.type        is distinct from coalesce(public.products.type,      excluded.type)
      or public.products.image_url   is distinct from coalesce(public.products.image_url, excluded.image_url)
      or (
           (public.products.images is null or jsonb_array_length(public.products.images) = 0)
           and excluded.images is not null and jsonb_array_length(excluded.images) > 0
         )
      or (coalesce(public.products.raw_data, '{}'::jsonb) || jsonb_build_object('shopmy', excluded.raw_data->'shopmy'))
           is distinct from coalesce(public.products.raw_data, '{}'::jsonb)
    returning (xmax = 0) as was_insert
  )
  select count(*) filter (where was_insert),
         count(*) filter (where not was_insert)
    into v_inserted, v_merged
    from ins;

  return jsonb_build_object('inserted', v_inserted, 'merged', v_merged);
end $$;

revoke all on function public.shopmy_upsert_batch(jsonb) from public, anon, authenticated;
grant execute on function public.shopmy_upsert_batch(jsonb) to service_role;
