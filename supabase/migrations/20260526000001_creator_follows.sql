-- Shopper → curator follow relationships. Keyed by handle (not
-- user_id) so legacy seed creators in app/data/looks.ts can still
-- be followed even though they don't have a profiles row.

create table if not exists public.creator_follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  followee_handle text not null,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_handle)
);

create index if not exists creator_follows_followee_idx
  on public.creator_follows (followee_handle);
create index if not exists creator_follows_follower_idx
  on public.creator_follows (follower_id, created_at desc);

alter table public.creator_follows enable row level security;

-- Anyone signed in can read (so the FOLLOW button on a creator
-- page can show the live follower count to any visitor).
create policy creator_follows_read on public.creator_follows
  for select using (true);

-- A shopper can only insert / delete their own follow rows.
create policy creator_follows_self_insert on public.creator_follows
  for insert with check (auth.uid() = follower_id);
create policy creator_follows_self_delete on public.creator_follows
  for delete using (auth.uid() = follower_id);
