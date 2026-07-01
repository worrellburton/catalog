-- Clears the `rls_disabled_in_public` security-advisor ERROR (the "Table
-- publicly accessible" alert) for the two remaining tables without RLS.
-- Mirrors the existing public-reference convention used by `musics`:
-- public SELECT + authenticated-admin writes.

-- 1) product_types: public reference data (read by the consumer feed;
--    written only by the admin type-governance tool + edge fn / pg_cron).
alter table public.product_types enable row level security;

create policy product_types_select_all
  on public.product_types for select
  to anon, authenticated
  using (true);

create policy product_types_insert_admin
  on public.product_types for insert
  to authenticated
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.is_admin = true or p.role = any (array['admin','super_admin']))
  ));

create policy product_types_update_admin
  on public.product_types for update
  to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.is_admin = true or p.role = any (array['admin','super_admin']))
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.is_admin = true or p.role = any (array['admin','super_admin']))
  ));

create policy product_types_delete_admin
  on public.product_types for delete
  to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.is_admin = true or p.role = any (array['admin','super_admin']))
  ));

-- 2) _hls_url_backup_20260612: stale one-off backup, not referenced by the
--    app. Lock it down (service-role only) — no anon/authenticated policy.
alter table public._hls_url_backup_20260612 enable row level security;
