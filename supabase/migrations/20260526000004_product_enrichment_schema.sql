-- Product enrichment schema: structured variant data, size charts, AI-derived
-- fit intelligence, brand sizing profiles, and confidence scoring.
--
-- All product-level enrichment fields are JSONB on the products row because
-- they are always read alongside the product, never queried independently
-- at scale, and their shape evolves faster than the relational schema.

-- ── New JSONB columns on products ────────────────────────────────────────

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS raw_data jsonb,
  ADD COLUMN IF NOT EXISTS variants jsonb,
  ADD COLUMN IF NOT EXISTS size_chart jsonb,
  ADD COLUMN IF NOT EXISTS normalized_measurements jsonb,
  ADD COLUMN IF NOT EXISTS fit_intelligence jsonb,
  ADD COLUMN IF NOT EXISTS materials_structured jsonb,
  ADD COLUMN IF NOT EXISTS product_taxonomy jsonb,
  ADD COLUMN IF NOT EXISTS styling_metadata jsonb,
  ADD COLUMN IF NOT EXISTS confidence_scores jsonb,
  ADD COLUMN IF NOT EXISTS enrichment_version integer DEFAULT 0;

COMMENT ON COLUMN public.products.raw_data IS
  'Snapshot of the original scraped data before any normalization or enrichment.';
COMMENT ON COLUMN public.products.variants IS
  'Array of variant objects: [{size, color, availability, sku, price_modifier}].';
COMMENT ON COLUMN public.products.size_chart IS
  'Parsed size chart keyed by size label -> measurement object in cm: {"M": {"chest_cm": 102, "waist_cm": 86}}.';
COMMENT ON COLUMN public.products.normalized_measurements IS
  'Universal body measurements per size, normalized to cm: {"M": {"chest_cm": 102, "waist_cm": 86, "shoulder_cm": 46}}.';
COMMENT ON COLUMN public.products.fit_intelligence IS
  'AI-derived fit analysis: {fit_type, body_type_match[], layering, warmth_rating, stretch_behavior, likely_feel}.';
COMMENT ON COLUMN public.products.materials_structured IS
  'Parsed material composition: [{fiber: "cotton", pct: 75}, {fiber: "polyester", pct: 25}].';
COMMENT ON COLUMN public.products.product_taxonomy IS
  'Hierarchical categorization: {category, subcategory, style}. More specific than the flat type column.';
COMMENT ON COLUMN public.products.styling_metadata IS
  'AI-generated styling context: {works_with[], occasion[], season[]}.';
COMMENT ON COLUMN public.products.confidence_scores IS
  'Per-field confidence 0-1: {price: 0.99, size_chart: 0.7, fit_intelligence: 0.65}.';
COMMENT ON COLUMN public.products.enrichment_version IS
  'Tracks which enrichment pipeline version populated this row. Bump to re-enrich.';

-- ── Brand fit profiles (shared across products) ─────────────────────────

CREATE TABLE IF NOT EXISTS public.brand_fit_profiles (
  brand text PRIMARY KEY,
  fit_bias text,
  silhouette text,
  stretch text,
  size_system text,
  quality_tier text,
  sample_count integer DEFAULT 0,
  confidence numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.brand_fit_profiles IS
  'Brand-level sizing intelligence aggregated from individual product scrapes. Grows more accurate as more products are scraped per brand.';
COMMENT ON COLUMN public.brand_fit_profiles.fit_bias IS
  'runs_small | true_to_size | runs_large';
COMMENT ON COLUMN public.brand_fit_profiles.silhouette IS
  'slim | regular | relaxed | oversized';
COMMENT ON COLUMN public.brand_fit_profiles.stretch IS
  'none | low | medium | high';
COMMENT ON COLUMN public.brand_fit_profiles.size_system IS
  'US | EU | UK | JP | universal';
COMMENT ON COLUMN public.brand_fit_profiles.quality_tier IS
  'budget | mid | premium | luxury';

ALTER TABLE public.brand_fit_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read brand profiles"
  ON public.brand_fit_profiles FOR SELECT
  USING (true);

CREATE POLICY "service write brand profiles"
  ON public.brand_fit_profiles FOR ALL
  USING (true);

-- Auto-update updated_at on brand_fit_profiles
CREATE OR REPLACE FUNCTION public.trg_brand_fit_profiles_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_brand_fit_profiles_updated_at ON public.brand_fit_profiles;
CREATE TRIGGER set_brand_fit_profiles_updated_at
  BEFORE UPDATE ON public.brand_fit_profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_brand_fit_profiles_updated_at();
