-- ============================================================
-- 017: Admin hidden content
-- ============================================================
-- Persist "hide this look / product from admin Content page"
-- decisions across browsers and devices. Replaces the localStorage
-- fallback previously used (admin-deleted-look-ids / admin-deleted-product-keys).
--
-- Works for both static-data entries (looks from app/data/looks.ts,
-- not in DB) and DB-backed entries (belt-and-suspenders for anything
-- referenced from static look data).

BEGIN;

-- ─── Tables ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS admin_hidden_looks (
  look_id     integer PRIMARY KEY,
  hidden_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_hidden_products (
  brand       text NOT NULL,
  name        text NOT NULL,
  hidden_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (brand, name)
);

-- ─── RLS ────────────────────────────────────────────────────
-- Admin panel uses the anon key (see app/utils/supabase.ts),
-- so anon needs full CRUD. Matches pattern used for
-- crawl_jobs / crawl_discovered_urls in migration 011.

ALTER TABLE admin_hidden_looks ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_hidden_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read admin_hidden_looks"
  ON admin_hidden_looks FOR SELECT USING (true);

CREATE POLICY "Admin write admin_hidden_looks"
  ON admin_hidden_looks FOR ALL
  TO anon, authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Public read admin_hidden_products"
  ON admin_hidden_products FOR SELECT USING (true);

CREATE POLICY "Admin write admin_hidden_products"
  ON admin_hidden_products FOR ALL
  TO anon, authenticated
  USING (true) WITH CHECK (true);

COMMIT;
