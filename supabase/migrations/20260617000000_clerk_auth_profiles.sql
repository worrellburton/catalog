-- 20260617000000_clerk_auth_profiles.sql
--
-- Phase 4 (schema) — prepare `profiles` to be fed by Clerk instead of the
-- Supabase-Auth trigger on auth.users.
--
-- APPLY AT CUTOVER, not before: it only loosens constraints (safe to run while
-- still on Supabase Auth), but it pairs with the clerk-webhook function and the
-- Phase 2 RLS swap. The RLS policy rewrite (auth.uid() -> the Clerk `app_uid`
-- claim) is intentionally NOT here — changing it early would break live Supabase
-- sessions, so it ships with the cutover.
--
-- Two changes:
--  1. Drop profiles.id -> auth.users(id) FK. After cutover users are created in
--     Clerk, so they have no auth.users row; the FK would reject every new
--     profile. id stays a uuid PK (= the user's app_uid / Clerk external_id).
--  2. Add clerk_user_id so the webhook can map Clerk's `user.deleted` event
--     (which carries only the Clerk id, not external_id) back to a profile, and
--     so admin can cross-reference.

-- 1. Drop the auth.users FK by whatever name it was created under.
do $$
declare
  fk_name text;
begin
  select con.conname into fk_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'profiles'
    and con.contype = 'f'
    and pg_get_constraintdef(con.oid) ilike '%auth.users%';
  if fk_name is not null then
    execute format('alter table public.profiles drop constraint %I', fk_name);
  end if;
end $$;

-- 2. Clerk id mapping (nullable: migrated rows backfill it on the user's first
--    Clerk webhook; native Clerk signups get it immediately).
alter table public.profiles
  add column if not exists clerk_user_id text;

create unique index if not exists profiles_clerk_user_id_key
  on public.profiles (clerk_user_id)
  where clerk_user_id is not null;
