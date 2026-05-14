-- Track per-look bookmark/save counts across all visitors.
-- Uses a client-generated device_id (stored in localStorage) so anonymous
-- users can be counted without requiring auth.

create table if not exists public.look_saves (
  look_uuid  uuid not null,
  device_id  text not null,
  created_at timestamptz not null default now(),
  primary key (look_uuid, device_id)
);

alter table public.look_saves enable row level security;

-- Anyone can read (needed to display counts)
create policy "look_saves_public_read" on public.look_saves
  for select using (true);

-- Any client can insert their own device's save
create policy "look_saves_insert" on public.look_saves
  for insert with check (true);

-- Any client can remove their own device's save
create policy "look_saves_delete" on public.look_saves
  for delete using (true);

create index if not exists idx_look_saves_look_uuid on public.look_saves (look_uuid);
