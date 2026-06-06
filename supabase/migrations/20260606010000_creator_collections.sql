-- Per-creator named collections (e.g. "Cool"). Mirrors the localStorage
-- saved-collections shape (services/saved-layout.ts) so the Saved screen can
-- sync a shopper's collections to the cloud, and the public creator catalog
-- can surface them as Shop-tab filters instead of auto-derived categories.
create table if not exists public.creator_collections (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  client_id    text not null,                  -- localStorage collection id, for idempotent upsert
  name         text not null,
  product_keys text[] not null default '{}',   -- "brand::name" product keys
  look_ids     bigint[] not null default '{}',
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, client_id)
);

alter table public.creator_collections enable row level security;

-- Public read: collections surface on the public creator catalog.
create policy "creator_collections_select_public" on public.creator_collections
  for select using (true);
-- Owner-only writes.
create policy "creator_collections_insert_own" on public.creator_collections
  for insert with check (auth.uid() = user_id);
create policy "creator_collections_update_own" on public.creator_collections
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "creator_collections_delete_own" on public.creator_collections
  for delete using (auth.uid() = user_id);

create index if not exists idx_creator_collections_user
  on public.creator_collections(user_id, sort_order);
