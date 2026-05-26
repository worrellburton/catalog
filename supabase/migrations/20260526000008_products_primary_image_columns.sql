-- Primary image selection: a curated "solo product" shot per row.
-- The scrape pipeline collects every image the merchant ships
-- (lifestyle, on-model, multi-product, packaging, swatches, etc.)
-- and stuffs them into products.images. The cleanest one — product
-- alone on a plain background, no human, no siblings — is what the
-- consumer feed + generator pipeline both want for product chips
-- and image-to-video conditioning. A vision pass selects it via
-- the pick-primary-image edge function.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS primary_image_url text,
  ADD COLUMN IF NOT EXISTS primary_image_index integer,
  ADD COLUMN IF NOT EXISTS primary_image_score real,
  ADD COLUMN IF NOT EXISTS primary_image_picked_at timestamptz,
  ADD COLUMN IF NOT EXISTS primary_image_picked_by text;

CREATE INDEX IF NOT EXISTS products_primary_image_picked_at_idx
  ON public.products (primary_image_picked_at NULLS FIRST);

COMMENT ON COLUMN public.products.primary_image_url IS
  'The product-solo image chosen by the vision picker (no human, no other products). Falls back to image_url when null.';
COMMENT ON COLUMN public.products.primary_image_index IS
  'Position within products.images of the picked primary; -1 when the pick was the legacy image_url, NULL when unpicked.';
COMMENT ON COLUMN public.products.primary_image_score IS
  'Confidence score from the vision picker (0..1). Lower scores can be flagged for human review.';
COMMENT ON COLUMN public.products.primary_image_picked_by IS
  'Source of the pick: ''vision'' (auto), ''admin'' (manual override).';
