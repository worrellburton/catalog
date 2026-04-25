-- Persist the shopper's picked reference photos across sessions /
-- devices. One row per user, holding an ordered uuid[] of upload ids
-- (length up to MAX_PHOTOS = 3 in the client, but the column is open
-- so the cap can move without a migration). Replaces the per-browser
-- localStorage we were using.

create table if not exists public.user_generation_slots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  upload_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);

comment on table public.user_generation_slots is
  'Persisted reference-photo slot picks for the Generate page. Survives sessions and roams across devices for the same shopper.';

alter table public.user_generation_slots enable row level security;

drop policy if exists user_generation_slots_self_read on public.user_generation_slots;
create policy user_generation_slots_self_read on public.user_generation_slots for select
  using (auth.uid() = user_id);

drop policy if exists user_generation_slots_self_write on public.user_generation_slots;
create policy user_generation_slots_self_write on public.user_generation_slots for insert
  with check (auth.uid() = user_id);

drop policy if exists user_generation_slots_self_update on public.user_generation_slots;
create policy user_generation_slots_self_update on public.user_generation_slots for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists user_generation_slots_self_delete on public.user_generation_slots;
create policy user_generation_slots_self_delete on public.user_generation_slots for delete
  using (auth.uid() = user_id);
