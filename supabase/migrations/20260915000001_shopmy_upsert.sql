-- Batch writer for ShopMy ingest. Insert-or-fill-nulls on the normalised URL.
--
-- A ShopMy pin carries one image and no description, so it must NEVER
-- overwrite richer data from a real scrape - every conflict path uses
-- coalesce(existing, incoming), not the reverse.
--
-- Batches are capped at 25 because each inserted row fires
-- trg_products_auto_verify_image and trg_products_auto_embed, each a
-- net.http_post to an edge function.
--
-- products.price is `text` here (not numeric - existing rows already mix
-- "$49.00" and "49"), so price is passed through as-is with no numeric cast.

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

  with incoming as (
    select
      e->>'url'            as url,
      e->>'name'           as name,
      e->>'brand'          as brand,
      e->>'price'          as price,
      e->>'currency'       as currency,
      e->>'type'           as type,
      e->>'image_url'      as image_url,
      e->'images'          as images,
      e->'raw_data'        as raw_data
    from jsonb_array_elements(rows) e
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
