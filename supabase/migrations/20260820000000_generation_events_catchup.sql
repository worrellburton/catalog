-- generation_events already exists in the live project (611 rows since
-- 2026-05-01) but was created out-of-band, so the repo has never recorded its
-- shape. This is a catch-up: `if not exists` throughout, so applying it against
-- the live database is a no-op that only writes the definition into the repo's
-- migration history. No data is created, altered, or deleted.
--
-- Written by supabase/functions/generate-look/index.ts (submit_attempt,
-- image_rehost_faces, image_rehost_products, image_preflight,
-- seedance_face_grid, fal_submit_ok, fal_submit_fail, fal_submit_fallback,
-- fal_submit_fallback_skipped, content_policy_fallback),
-- supabase/functions/fal-webhook/index.ts (fal_webhook, content_policy_fallback),
-- and app/services/user-generations.ts:698-720 (nameLookForGeneration).
-- watchdog_timeout comes from the reconciler / naming paths.

create table if not exists public.generation_events (
  id            bigserial primary key,
  generation_id uuid not null references public.user_generations(id) on delete cascade,
  event         text not null,
  payload       jsonb,
  created_at    timestamptz not null default now()
);

-- The admin audit page reads one generation's events in time order. Without
-- this the spine query is a full scan of the table.
create index if not exists generation_events_gen_created_idx
  on public.generation_events (generation_id, created_at);

-- Row level security was already enabled in production (relrowsecurity = true).
-- This statement is a no-op on the live database but ensures parity for fresh
-- deployments.
alter table public.generation_events enable row level security;

-- Three writers: generate-look and fal-webhook (service role, bypass RLS),
-- and the browser-side nameLookForGeneration (anon key). Writes are covered by
-- the "service role full access" policy below, which is open to {public} roles.

-- Owners read their own generation's events.
drop policy if exists "owner read" on public.generation_events;
create policy "owner read"
  on public.generation_events for select
  using (generation_id in (select user_generations.id from user_generations
                           where user_generations.user_id = (select auth.uid())));

-- Service role (and anon, via {public} role) can read/write.
drop policy if exists "service role full access" on public.generation_events;
create policy "service role full access"
  on public.generation_events for all
  using true
  with check true;

-- Admin-only read.
--
-- `(select auth.uid())` rather than a bare `auth.uid()` is deliberate and is the
-- house pattern (see the "admins read pipeline_events" policy): the subquery form
-- is evaluated once per statement instead of once per row.
drop policy if exists "admins read generation events" on public.generation_events;
create policy "admins read generation events"
  on public.generation_events for select
  using (exists (select 1 from public.profiles me
                 where me.id = (select auth.uid()) and me.is_admin));
