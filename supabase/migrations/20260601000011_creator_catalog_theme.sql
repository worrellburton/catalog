-- Per-creator catalog theme. A creator can set their catalog to render
-- light or dark for ALL viewers. NULL = the app default (dark). Stored on
-- the creators row (keyed by handle, the catalog's stable identity).
alter table public.creators
  add column if not exists catalog_theme text
  check (catalog_theme in ('light', 'dark'));

-- Let the owning user update their own creators row's theme. Read is
-- already public (catalogs are public surfaces); writes are owner-only.
-- creators.id == auth user id for real (non-AI) creators.
drop policy if exists "creators_owner_update_theme" on public.creators;
create policy "creators_owner_update_theme"
  on public.creators
  for update
  using (id = auth.uid())
  with check (id = auth.uid());
