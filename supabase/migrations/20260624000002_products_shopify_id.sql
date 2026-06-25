-- Idempotency key for Shopify product sync (Phase 3 of the Shopify brand portal).
--
-- shopify-sync upserts on (brand_id, shopify_product_id). The index is NOT
-- partial: under PG's default NULLS DISTINCT, every existing non-Shopify row
-- (shopify_product_id IS NULL) stays unique-distinct, so they're unaffected;
-- uniqueness is only enforced for real Shopify rows (both columns non-null).

alter table public.products add column if not exists shopify_product_id text;

create unique index if not exists products_brand_shopify_id_idx
  on public.products (brand_id, shopify_product_id);
