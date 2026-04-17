-- Create scraped-products storage bucket
-- Stores JSON files with product data extracted by the scrape-product edge function

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'scraped-products',
  'scraped-products',
  true,
  5242880,  -- 5MB limit (JSON files are small)
  ARRAY['application/json']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- ─── RLS policies ────────────────────────────────────────────────────

-- Service role (edge function) can insert files
CREATE POLICY "Service role can upload scraped products"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'scraped-products');

-- Authenticated users can read scraped products
CREATE POLICY "Authenticated users can read scraped products"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'scraped-products');

-- Public read access for scraped products
CREATE POLICY "Public can read scraped products"
  ON storage.objects FOR SELECT
  TO anon
  USING (bucket_id = 'scraped-products');

-- Service role can delete scraped products
CREATE POLICY "Service role can delete scraped products"
  ON storage.objects FOR DELETE
  TO service_role
  USING (bucket_id = 'scraped-products');
