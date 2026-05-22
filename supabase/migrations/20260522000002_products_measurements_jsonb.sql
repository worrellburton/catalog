-- Structured per-product measurements so the product page can render a
-- garment diagram (neck width, sleeve length, chest width, length…)
-- instead of just dumping the raw size_fit text. Keyed by measurement
-- code (snake_case) → centimeters as a number. The scraper agent
-- backfills this on its next pass; the diagram only renders when at
-- least one keyed value is present, so existing rows degrade to the
-- prior copy-only view.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS measurements jsonb;

COMMENT ON COLUMN public.products.measurements IS
  'Structured garment measurements keyed by code (snake_case) -> centimeters as a number. Surfaced as a diagram on the product page. Null until the scraper backfill lands a value.';
