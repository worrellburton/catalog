-- Admin UI replaces the binary Gender pill with a dropdown of
-- All / Women / Men / Unisex. The existing CHECK constraint only
-- allowed 'all' | 'men' | 'women' — extend it so 'unisex' rows can
-- save. Drop-and-recreate is the simplest path for a CHECK; no
-- existing row falls outside the new domain so no data work needed.

alter table public.catalogs drop constraint if exists catalogs_gender_check;
alter table public.catalogs
  add constraint catalogs_gender_check
  check (gender = any (array['all', 'men', 'women', 'unisex']));
