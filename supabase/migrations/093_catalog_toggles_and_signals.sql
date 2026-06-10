-- 093_catalog_toggles_and_signals.sql
-- Adds per-catalog feed-control toggles, a 'home' catalog row,
-- and product-level conversion + age signals.

-- ── Catalogs: feed-control toggles ────────────────────────────────────────
ALTER TABLE catalogs
  ADD COLUMN IF NOT EXISTS is_home              boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS filter_gender        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS filter_age           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS boost_top_converting boolean NOT NULL DEFAULT false;

-- Only one catalog may be the home row at a time.
CREATE UNIQUE INDEX IF NOT EXISTS catalogs_one_home_idx
  ON catalogs (is_home)
  WHERE is_home = true;

-- ── Products: age_group + conversion_score ────────────────────────────────
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS age_group        text  CHECK (age_group IN ('teen','young_adult','adult','mature')),
  ADD COLUMN IF NOT EXISTS conversion_score real  NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS products_conversion_score_idx
  ON products (conversion_score DESC)
  WHERE is_active = true;

-- ── Seed the home catalog ─────────────────────────────────────────────────
-- sort_order = -1 so it floats above all other rows when ordered ASC.
INSERT INTO catalogs (slug, name, description, gender, status, is_featured, is_home, sort_order)
VALUES ('home', 'Home', 'Products pinned to the top of the consumer landing feed.', 'all', 'live', false, true, -1)
ON CONFLICT (slug) DO UPDATE
  SET is_home    = true,
      status     = 'live',
      sort_order = -1;

-- ── RPC: refresh_product_conversion_scores ────────────────────────────────
-- Rolls up product_creative click-through rates into products.conversion_score.
-- Run once after deploy; schedule via pg_cron or a Vercel cron job.
CREATE OR REPLACE FUNCTION refresh_product_conversion_scores()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE products p
  SET conversion_score = COALESCE(s.ctr, 0)
  FROM (
    SELECT
      product_id,
      SUM(clicks)::real / NULLIF(SUM(impressions), 0) AS ctr
    FROM product_creative
    GROUP BY product_id
  ) s
  WHERE p.id = s.product_id;
$$;

-- ── RPC: catalog_search_counts ────────────────────────────────────────────
-- Returns search counts per catalog name from search_logs.
-- Used by the admin catalog list to show how often each catalog is queried
-- by shoppers in the feed search bar.
CREATE OR REPLACE FUNCTION catalog_search_counts(catalog_names text[])
RETURNS TABLE(
  catalog_name text,
  count_24h    bigint,
  count_7d     bigint,
  count_total  bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    n.name                                                                    AS catalog_name,
    COUNT(*) FILTER (WHERE sl.created_at >= NOW() - INTERVAL '24 hours')     AS count_24h,
    COUNT(*) FILTER (WHERE sl.created_at >= NOW() - INTERVAL '7 days')       AS count_7d,
    COUNT(*)                                                                  AS count_total
  FROM unnest(catalog_names) AS n(name)
  LEFT JOIN search_logs sl ON LOWER(sl.query) = LOWER(n.name)
  GROUP BY n.name;
$$;
