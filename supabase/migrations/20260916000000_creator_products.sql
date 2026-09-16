-- Per-creator product attribution for imported storefronts.
--
-- products rows are deduplicated on normalize_product_url() and are therefore
-- SHARED between creators, while products.affiliate_url is a single scalar.
-- Two creators who pin the same item cannot both be credited by any
-- single-valued column on products, so the relationship gets its own table.
--
-- raw_data.shopmy is not an alternative: shopmy_upsert_batch replaces that
-- whole key on every upsert, so a second curator's ingest silently overwrites
-- the first curator's pin_id.

create table if not exists public.creator_products (
  creator_handle  text not null references public.creators(handle) on delete cascade,
  product_id      uuid not null references public.products(id)     on delete cascade,
  source          text not null default 'shopmy',
  shopmy_pin_id   bigint,
  affiliate_url   text,
  collection_name text,
  section_name    text,
  sort_order      int  not null default 0,
  created_at      timestamptz not null default now(),
  primary key (creator_handle, product_id)
);

create index if not exists creator_products_handle_order_idx
  on public.creator_products (creator_handle, sort_order);

alter table public.creator_products enable row level security;

-- Mirrors products: the catalog is public, writes are service-role only.
-- Deliberately NO insert/update/delete policy — RLS with no permissive
-- policy denies every non-service-role write.
drop policy if exists "Public read creator_products" on public.creator_products;
create policy "Public read creator_products"
  on public.creator_products for select using (true);

-- Provenance on the creator itself. source_url is what lets the wizard say
-- "already imported - will update", and what a future re-sync would read.
alter table public.creators add column if not exists source     text;
alter table public.creators add column if not exists source_url text;

-- Link a batch of already-upserted products to a creator.
--
-- Resolves product_id by the SAME normalize_product_url() key the products
-- unique index uses, because shopmy_upsert_batch cannot return ids: its
-- no-op guard (20260915000002) means an unchanged row produces no RETURNING
-- row at all, so an idempotent re-run would link nothing.
--
-- affiliate_url is passed in, not built here, so the go.shopmy.us shape has
-- exactly one definition (pinAffiliateUrl in _shared/shopmy.ts) with one test.
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
  if jsonb_typeof(rows) <> 'array' then
    raise exception 'rows must be a jsonb array';
  end if;

  select jsonb_array_length(rows) into v_seen;

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
