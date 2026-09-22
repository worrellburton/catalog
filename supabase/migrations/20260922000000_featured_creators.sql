-- Featured creators for the consumer /creators directory. Keyed by the
-- creator handle (creators.handle, or user:<uuid> for profile-only
-- creators) so both kinds can be featured. Admin-curated from
-- /admin/creators; sort_order orders the featured grid.
CREATE TABLE IF NOT EXISTS featured_creators (
  handle      text PRIMARY KEY,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE featured_creators ENABLE ROW LEVEL SECURITY;

-- Same posture as admin_hidden_looks (migration 017): the admin panel uses
-- the anon key, so anon/authenticated get full CRUD; everyone can read.
CREATE POLICY "Public read featured_creators"
  ON featured_creators FOR SELECT USING (true);

CREATE POLICY "Admin write featured_creators"
  ON featured_creators FOR ALL
  TO anon, authenticated
  USING (true) WITH CHECK (true);
