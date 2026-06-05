-- ============================================================
-- Admin hidden content — uuid-keyed look hides
-- ============================================================
-- Supersedes 017_admin_hidden_content.sql. The original table keyed hides
-- on a single integer `look_id`, but DB-backed looks have no stable numeric
-- id (legacy_id is null, so the client derives a synthetic id). Hiding by
-- that id silently broke — the id reshuffled per fetch, so a stored hide
-- matched a different look (or all of them). Looks now hide by their stable
-- `uuid`; the numeric `look_id` lane is retained only for legacy seed looks.
--
-- Idempotent + forward-compatible: creates the tables fresh in the final
-- shape, and upgrades the legacy 017 shape (look_id PRIMARY KEY) in place
-- for any environment where 017 already ran.

BEGIN;

-- ─── admin_hidden_looks ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_hidden_looks (
  look_id    integer,
  look_uuid  uuid,
  hidden_at  timestamptz NOT NULL DEFAULT now()
);

-- Upgrade the legacy 017 shape: add the uuid column and relax the look_id
-- PRIMARY KEY / NOT NULL so a uuid-only hide can be stored.
ALTER TABLE admin_hidden_looks ADD COLUMN IF NOT EXISTS look_uuid uuid;
ALTER TABLE admin_hidden_looks DROP CONSTRAINT IF EXISTS admin_hidden_looks_pkey;
ALTER TABLE admin_hidden_looks ALTER COLUMN look_id DROP NOT NULL;

-- Full unique constraints (nullable columns allow many NULLs in Postgres)
-- so PostgREST upserts can target either key via
-- ON CONFLICT (look_id) / ON CONFLICT (look_uuid).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_hidden_looks_look_id_key') THEN
    ALTER TABLE admin_hidden_looks ADD CONSTRAINT admin_hidden_looks_look_id_key UNIQUE (look_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_hidden_looks_look_uuid_key') THEN
    ALTER TABLE admin_hidden_looks ADD CONSTRAINT admin_hidden_looks_look_uuid_key UNIQUE (look_uuid);
  END IF;
END $$;

-- ─── admin_hidden_products ──────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_hidden_products (
  brand      text NOT NULL,
  name       text NOT NULL,
  hidden_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (brand, name)
);

-- ─── RLS ────────────────────────────────────────────────────
-- The admin panel + consumer feed both use the anon key (see
-- app/utils/supabase.ts), so anon needs read + write. Policies are
-- recreated idempotently.
ALTER TABLE admin_hidden_looks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_hidden_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read admin_hidden_looks"  ON admin_hidden_looks;
CREATE POLICY "Public read admin_hidden_looks"
  ON admin_hidden_looks FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admin write admin_hidden_looks"  ON admin_hidden_looks;
CREATE POLICY "Admin write admin_hidden_looks"
  ON admin_hidden_looks FOR ALL
  TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public read admin_hidden_products" ON admin_hidden_products;
CREATE POLICY "Public read admin_hidden_products"
  ON admin_hidden_products FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admin write admin_hidden_products" ON admin_hidden_products;
CREATE POLICY "Admin write admin_hidden_products"
  ON admin_hidden_products FOR ALL
  TO anon, authenticated
  USING (true) WITH CHECK (true);

COMMIT;
