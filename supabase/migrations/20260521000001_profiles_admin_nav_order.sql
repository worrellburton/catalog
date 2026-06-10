-- Per-admin MRU sidebar order. Whenever an admin opens an admin
-- page, the matching nav item bubbles to the top of this array.
-- jsonb (not text[]) so we can swap representations later (e.g.
-- carry last-visited timestamps) without another migration.
--
-- Default '[]' so anything reading the column gets an empty list
-- and renders the original navItems order. The frontend filters
-- stale entries against the live navItems whitelist so removed
-- pages drop out automatically.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS admin_nav_order jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.profiles.admin_nav_order IS
  'Per-admin MRU order of the /admin sidebar items. Stores an array of nav.to strings, most-recently-visited first. The admin UI prepends visited entries to the static navItems order and drops items not on the whitelist.';
