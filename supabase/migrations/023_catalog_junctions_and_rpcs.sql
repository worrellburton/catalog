-- 023: Catalog extensions + junctions + auto-assign RPCs
--
-- Additive on top of 021_catalogs_table.sql (origin/main). Adds the
-- extra columns we need for auto-assign, introduces the catalog_looks and
-- catalog_products junction tables (UUID-keyed off catalogs.id), and wires
-- up two RPCs: one that scores every active product against a catalog's
-- theme prompt via pg_trgm similarity, and one that fans those top products
-- out to each look attached to the catalog.
--
-- Everything in here is idempotent: ADD COLUMN IF NOT EXISTS, CREATE TABLE
-- IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- plus drop-then-create for the gender / status check constraints since
-- those can't use IF NOT EXISTS. Safe to re-run.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- ============================================================================
-- 1. Extend catalogs with the columns auto-assign + admin UI need.
-- origin/main's 021 gave us (slug PK, name, description, sort, is_featured,
-- created_at). We need a UUID surrogate for junction FKs, plus theme_prompt,
-- gender scope, status, cover, updated_at.
-- ============================================================================

ALTER TABLE public.catalogs
  ADD COLUMN IF NOT EXISTS id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS theme_prompt  text,
  ADD COLUMN IF NOT EXISTS gender        text        NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS cover_url     text,
  ADD COLUMN IF NOT EXISTS status        text        NOT NULL DEFAULT 'live',
  ADD COLUMN IF NOT EXISTS updated_at    timestamptz NOT NULL DEFAULT now();

-- We renamed origin/main's `sort` → `sort_order` to match the rest of the
-- codebase; keep the old column around if it exists so we don't lose data.
ALTER TABLE public.catalogs ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
UPDATE public.catalogs SET sort_order = sort WHERE sort_order = 0 AND sort IS NOT NULL;

-- Check constraints — drop-then-create so we can re-run.
ALTER TABLE public.catalogs DROP CONSTRAINT IF EXISTS catalogs_gender_check;
ALTER TABLE public.catalogs
  ADD CONSTRAINT catalogs_gender_check CHECK (gender IN ('all','men','women'));
ALTER TABLE public.catalogs DROP CONSTRAINT IF EXISTS catalogs_status_check;
ALTER TABLE public.catalogs
  ADD CONSTRAINT catalogs_status_check CHECK (status IN ('draft','live','archived'));

-- Promote id to a PK alongside slug's UNIQUE. slug stays searchable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.catalogs'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE public.catalogs ADD PRIMARY KEY (id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalogs_slug ON public.catalogs(slug);
CREATE INDEX IF NOT EXISTS idx_catalogs_status ON public.catalogs(status);
CREATE INDEX IF NOT EXISTS idx_catalogs_featured ON public.catalogs(is_featured) WHERE is_featured = true;
CREATE INDEX IF NOT EXISTS idx_catalogs_sort ON public.catalogs(sort_order, name);

-- Keep updated_at fresh on UPDATE.
CREATE OR REPLACE FUNCTION public.catalogs_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS set_catalogs_updated_at ON public.catalogs;
CREATE TRIGGER set_catalogs_updated_at
  BEFORE UPDATE ON public.catalogs
  FOR EACH ROW EXECUTE FUNCTION public.catalogs_touch_updated_at();

-- Seed: six starter catalogs drawn from catalogNames.ts vibes. Idempotent
-- upsert on slug; existing rows get their theme_prompt / gender filled in if
-- they were seeded by origin/main's 021 without those fields.
INSERT INTO public.catalogs (slug, name, description, theme_prompt, gender, sort_order, is_featured, status) VALUES
  ('main-character-energy', 'Main Character Energy',
   'Confident, put-together fits with a little drama.',
   'Confident statement outfits with sharp tailoring, elevated basics, and one hero piece. Lean into drama and presence.',
   'all', 10, true, 'live'),
  ('quiet-luxury', 'Quiet Luxury',
   'Old-money minimalism. Cashmere, camel, silk, leather — no logos.',
   'Timeless, logo-free luxury: cashmere knits, silk, fine leather, camel/cream/navy palette, impeccable tailoring.',
   'all', 20, true, 'live'),
  ('off-duty-model', 'Off-Duty Model',
   'Paparazzi-proof basics. White tank, blue jeans, loafers, a coffee.',
   'Effortless off-duty uniforms: fitted tees, straight-leg jeans, loafers or sneakers, vintage tote, sunglasses.',
   'women', 30, true, 'live'),
  ('rizz-catalog', 'Rizz Catalog',
   'First-date ready. Smells clean, drapes right.',
   'Date night outfits that photograph well in low light: knit polos, crisp shirts, selvedge denim, clean sneakers, a chain.',
   'men', 40, true, 'live'),
  ('streetwear-sunday', 'Streetwear Sunday',
   'Hype drop weekend. Sneaker rotation on.',
   'Hype-leaning streetwear: graphic tees, cargo pants, hoodies, sought-after sneakers, caps, chains.',
   'all', 50, true, 'live'),
  ('coastal-grandma', 'Coastal Grandma',
   'Linen and lemonade. Nantucket summer energy.',
   'Relaxed coastal luxe: linen sets, cream knits, straw totes, sun hats, espadrilles, soft neutrals with a pop of navy.',
   'women', 60, true, 'live')
ON CONFLICT (slug) DO UPDATE SET
  description  = coalesce(EXCLUDED.description, public.catalogs.description),
  theme_prompt = coalesce(EXCLUDED.theme_prompt, public.catalogs.theme_prompt),
  gender       = coalesce(EXCLUDED.gender, public.catalogs.gender),
  sort_order   = EXCLUDED.sort_order,
  is_featured  = EXCLUDED.is_featured,
  status       = EXCLUDED.status;

-- ============================================================================
-- 2. catalog_looks — junction between catalogs and looks.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.catalog_looks (
  catalog_id uuid NOT NULL REFERENCES public.catalogs(id) ON DELETE CASCADE,
  look_id    uuid NOT NULL REFERENCES public.looks(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (catalog_id, look_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_looks_look ON public.catalog_looks(look_id);
CREATE INDEX IF NOT EXISTS idx_catalog_looks_catalog_sort ON public.catalog_looks(catalog_id, sort_order);

ALTER TABLE public.catalog_looks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read catalog_looks" ON public.catalog_looks;
CREATE POLICY "Public read catalog_looks" ON public.catalog_looks FOR SELECT USING (true);
DROP POLICY IF EXISTS "Service write catalog_looks" ON public.catalog_looks;
CREATE POLICY "Service write catalog_looks" ON public.catalog_looks FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Authenticated write catalog_looks" ON public.catalog_looks;
CREATE POLICY "Authenticated write catalog_looks" ON public.catalog_looks FOR ALL USING (auth.role() = 'authenticated');

-- Backfill: attach each of the 12 legacy live looks to 1–2 catalogs so the
-- detail page has data on first boot. Hand-mapped against the seed description
-- + gender of each look. No-op on re-run.
WITH mapping(legacy_id, slug, sort_order) AS (VALUES
  (1,  'main-character-energy', 10), (1,  'quiet-luxury', 10),
  (2,  'quiet-luxury', 20),          (2,  'main-character-energy', 20),
  (3,  'main-character-energy', 30), (3,  'quiet-luxury', 30),
  (4,  'main-character-energy', 40), (4,  'quiet-luxury', 40),
  (5,  'off-duty-model', 10),        (5,  'coastal-grandma', 10),
  (6,  'rizz-catalog', 10),          (6,  'quiet-luxury', 60),
  (7,  'off-duty-model', 20),        (7,  'quiet-luxury', 70),
  (8,  'main-character-energy', 50), (8,  'streetwear-sunday', 10),
  (9,  'main-character-energy', 60), (9,  'quiet-luxury', 90),
  (10, 'main-character-energy', 70), (10, 'quiet-luxury', 100),
  (11, 'coastal-grandma', 20),       (11, 'quiet-luxury', 110),
  (12, 'rizz-catalog', 20),          (12, 'quiet-luxury', 120)
)
INSERT INTO public.catalog_looks (catalog_id, look_id, sort_order)
SELECT c.id, l.id, m.sort_order
FROM mapping m
JOIN public.catalogs c ON c.slug = m.slug
JOIN public.looks l ON l.legacy_id = m.legacy_id
ON CONFLICT (catalog_id, look_id) DO NOTHING;

-- ============================================================================
-- 3. catalog_products — junction between catalogs and products (palette).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.catalog_products (
  catalog_id  uuid NOT NULL REFERENCES public.catalogs(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sort_order  integer NOT NULL DEFAULT 0,
  match_score real,
  source      text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','auto','imported')),
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (catalog_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_products_product ON public.catalog_products(product_id);
CREATE INDEX IF NOT EXISTS idx_catalog_products_catalog_sort ON public.catalog_products(catalog_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_catalog_products_catalog_score ON public.catalog_products(catalog_id, match_score DESC);

ALTER TABLE public.catalog_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read catalog_products" ON public.catalog_products;
CREATE POLICY "Public read catalog_products" ON public.catalog_products FOR SELECT USING (true);
DROP POLICY IF EXISTS "Service write catalog_products" ON public.catalog_products;
CREATE POLICY "Service write catalog_products" ON public.catalog_products FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Authenticated write catalog_products" ON public.catalog_products;
CREATE POLICY "Authenticated write catalog_products" ON public.catalog_products FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================================
-- 4. look_products: track provenance of product attachments so auto-assign
-- can be re-run without trampling explicit admin picks.
-- ============================================================================

ALTER TABLE public.look_products
  ADD COLUMN IF NOT EXISTS source            text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS added_at          timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS source_catalog_id uuid REFERENCES public.catalogs(id) ON DELETE SET NULL;

ALTER TABLE public.look_products DROP CONSTRAINT IF EXISTS look_products_source_check;
ALTER TABLE public.look_products
  ADD CONSTRAINT look_products_source_check CHECK (source IN ('manual','auto','imported'));

CREATE INDEX IF NOT EXISTS idx_look_products_look_sort ON public.look_products(look_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_look_products_source ON public.look_products(source);

-- ============================================================================
-- 5. RPCs: catalog_auto_assign_products + catalog_auto_assign_look_products
-- ============================================================================

-- Score every active product against a catalog's theme_prompt via trigram
-- similarity (name + brand). Top N → catalog_products with source='auto'.
-- Manual rows are preserved; auto rows are wiped first so repeat runs
-- converge on the current product catalog and scoring.
CREATE OR REPLACE FUNCTION public.catalog_auto_assign_products(
  p_catalog_id uuid,
  p_limit      integer DEFAULT 24,
  p_min_score  real    DEFAULT 0.05
)
RETURNS TABLE (inserted integer, total_candidates integer, top_score real)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_prompt    text;
  v_inserted  integer := 0;
  v_total     integer := 0;
  v_top       real    := 0;
BEGIN
  SELECT coalesce(theme_prompt, name) INTO v_prompt
  FROM public.catalogs WHERE id = p_catalog_id;

  IF v_prompt IS NULL OR length(trim(v_prompt)) = 0 THEN
    RETURN QUERY SELECT 0, 0, 0::real;
    RETURN;
  END IF;

  DELETE FROM public.catalog_products
  WHERE catalog_id = p_catalog_id AND source = 'auto';

  WITH scored AS (
    SELECT
      p.id AS product_id,
      similarity(coalesce(p.name, '') || ' ' || coalesce(p.brand, ''), v_prompt) AS score
    FROM public.products p
    WHERE coalesce(p.is_active, true) = true
      AND p.name IS NOT NULL AND length(trim(p.name)) > 0
  ),
  ranked AS (
    SELECT product_id, score FROM scored
    WHERE score >= p_min_score
    ORDER BY score DESC LIMIT p_limit
  ),
  inserted_rows AS (
    INSERT INTO public.catalog_products (catalog_id, product_id, sort_order, match_score, source)
    SELECT
      p_catalog_id,
      r.product_id,
      (row_number() OVER (ORDER BY r.score DESC))::integer * 10,
      r.score,
      'auto'
    FROM ranked r
    WHERE NOT EXISTS (
      SELECT 1 FROM public.catalog_products cp
      WHERE cp.catalog_id = p_catalog_id AND cp.product_id = r.product_id
    )
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM inserted_rows),
         (SELECT count(*) FROM scored WHERE score >= p_min_score),
         (SELECT max(score) FROM scored)
  INTO v_inserted, v_total, v_top;

  RETURN QUERY SELECT v_inserted, v_total, coalesce(v_top, 0::real);
END;
$$;

GRANT EXECUTE ON FUNCTION public.catalog_auto_assign_products(uuid, integer, real)
  TO authenticated, service_role;

-- For every look in the catalog, push the top p_per_look palette products onto
-- it (skipping products already attached to that look). source='auto',
-- source_catalog_id = p_catalog_id so we can wipe + re-apply cleanly.
CREATE OR REPLACE FUNCTION public.catalog_auto_assign_look_products(
  p_catalog_id uuid,
  p_per_look   integer DEFAULT 5
)
RETURNS TABLE (looks_touched integer, products_inserted integer)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_looks    integer := 0;
  v_inserted integer := 0;
BEGIN
  DELETE FROM public.look_products lp
  USING public.catalog_looks cl
  WHERE cl.catalog_id = p_catalog_id
    AND cl.look_id = lp.look_id
    AND lp.source = 'auto'
    AND lp.source_catalog_id = p_catalog_id;

  WITH look_set AS (
    SELECT cl.look_id FROM public.catalog_looks cl
    JOIN public.looks l ON l.id = cl.look_id
    WHERE cl.catalog_id = p_catalog_id
      AND l.status = 'live' AND coalesce(l.enabled, true) = true AND l.archived_at IS NULL
  ),
  palette AS (
    SELECT cp.product_id, cp.match_score, cp.sort_order FROM public.catalog_products cp
    WHERE cp.catalog_id = p_catalog_id
    ORDER BY coalesce(cp.match_score, 0) DESC, cp.sort_order ASC
  ),
  picks AS (
    SELECT
      ls.look_id,
      pa.product_id,
      row_number() OVER (
        PARTITION BY ls.look_id
        ORDER BY pa.match_score DESC NULLS LAST, pa.sort_order ASC
      ) AS rn
    FROM look_set ls
    CROSS JOIN palette pa
    WHERE NOT EXISTS (
      SELECT 1 FROM public.look_products lp
      WHERE lp.look_id = ls.look_id AND lp.product_id = pa.product_id
    )
  ),
  inserted AS (
    INSERT INTO public.look_products (look_id, product_id, sort_order, source, source_catalog_id)
    SELECT look_id, product_id, (rn * 10), 'auto', p_catalog_id
    FROM picks WHERE rn <= p_per_look
    RETURNING look_id
  )
  SELECT count(DISTINCT look_id), count(*)
  INTO v_looks, v_inserted
  FROM inserted;

  RETURN QUERY SELECT v_looks, v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.catalog_auto_assign_look_products(uuid, integer)
  TO authenticated, service_role;
