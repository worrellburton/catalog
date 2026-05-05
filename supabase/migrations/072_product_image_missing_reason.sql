-- Add image_missing_reason to products so the admin can see exactly why
-- a scraped product has no images (private S3 URLs, no images found, etc.)

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image_missing_reason text;

COMMENT ON COLUMN public.products.image_missing_reason IS
  'Set by the scraper when images[] is empty. E.g. "Private images — all URLs inaccessible (403)" or "No images found on page"';

-- Allow authenticated users (admin panel) to delete products.
DROP POLICY IF EXISTS "Auth users delete products" ON public.products;
CREATE POLICY "Auth users delete products" ON public.products
  FOR DELETE TO authenticated
  USING (true);

-- Also add UPDATE policy (migration 027 file exists locally but wasn't applied to remote).
DROP POLICY IF EXISTS "Auth users update products" ON public.products;
CREATE POLICY "Auth users update products" ON public.products
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);
