-- Track WHERE each product was added from. Surfaced as the "Method"
-- column in /admin/content. The Add Products dropdown sets one of:
--
--   'google_shopping' — research modal (SerpAPI)
--   'amazon'          — Rainforest ASIN/URL lookup
--   'brand_url'       — paste a brand product URL (scrape-product)
--
-- Existing rows are backfilled from the URL host where possible; the
-- rest stay null and render as '—' in the UI until they're refreshed.

alter table public.products
  add column if not exists source text;

create index if not exists products_source_idx on public.products (source);

-- Backfill: amazon.* domains -> 'amazon'. Anything else is left null
-- so we don't mislabel it.
update public.products
   set source = 'amazon'
 where source is null
   and url ~* 'amazon\.[a-z\.]+';

comment on column public.products.source is
  'Where the product was ingested from. One of: google_shopping, amazon, brand_url, or null for legacy rows.';
