-- 20260618010000_products_barcode.sql
--
-- Barcode / external identifier for a product: an Amazon ASIN, or a
-- UPC/EAN/GTIN pulled from the page or JSON-LD (Product.gtin12/gtin13). One
-- value column + a small type tag. Nullable — not every site exposes one
-- (most DTC/brand sites don't), so it's populated when available and left null
-- otherwise. Written by the product-scraper agent (see agents/product-scraper).

alter table public.products
  add column if not exists barcode text,
  add column if not exists barcode_type text
    check (barcode_type in ('asin', 'upc', 'ean', 'gtin') or barcode_type is null);

-- Lookups by barcode (dedupe / external matching) stay cheap.
create index if not exists products_barcode_idx
  on public.products (barcode)
  where barcode is not null;
