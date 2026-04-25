-- Per-user explicit admin flag. Coexists with the existing
-- profiles.role text column but is the canonical source-of-truth for
-- admin gating going forward. Backfilled from role='admin' so
-- existing admins keep access without manual toggling.

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

update public.profiles
   set is_admin = true
 where role = 'admin'
   and is_admin = false;

create index if not exists profiles_is_admin_idx
  on public.profiles (is_admin)
  where is_admin = true;

comment on column public.profiles.is_admin is
  'Explicit admin toggle. Surfaced as a checkbox in /admin/users; the Admins tab filters by this flag.';

-- Allow admins (anyone with is_admin=true on their own profile) to
-- update is_admin on any profile. Without this, RLS would block the
-- toggle from the client.
drop policy if exists profiles_admin_update_is_admin on public.profiles;
create policy profiles_admin_update_is_admin on public.profiles for update
  using (
    exists (
      select 1 from public.profiles me
      where me.id = auth.uid() and me.is_admin = true
    )
  )
  with check (
    exists (
      select 1 from public.profiles me
      where me.id = auth.uid() and me.is_admin = true
    )
  );
