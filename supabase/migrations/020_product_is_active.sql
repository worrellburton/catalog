-- Products gain an explicit active flag so admins can toggle whether a product
-- is eligible to serve on the feed without hard-deleting it. Auto-deactivate
-- obvious garbage rows (no price AND no valid URL) so the default Show all
-- view can be flipped to Show active.
alter table public.products
  add column if not exists is_active boolean not null default true;

comment on column public.products.is_active is
  'Admin toggle: when false the product is hidden from the consumer feed and skipped for ad generation.';

create index if not exists products_is_active_idx on public.products (is_active);

-- One-time backfill: products with no price and no URL are almost always bad
-- ingests (e.g. the "Error 400" / "sweaters" rows) so start them deactivated.
update public.products
   set is_active = false
 where is_active = true
   and (price is null or price = '' or price = '—')
   and (url is null or url = '');
