-- Comments on products and looks.
--
-- Shoppers can leave comments on any product or look detail surface. The
-- comment thread lives at /comments/<type>/<slug> and is keyed by the same
-- shareable slug the /p/<slug> and /l/<slug> deep-links already use, so a
-- comment attaches to a product/look regardless of how it was reached
-- (in-feed tap, cold load, pasted link). target_label snapshots the
-- product/look display name at write time purely so the admin Comments
-- page can render a human row without re-resolving every slug.
--
-- Feature flag: app_settings.comments_enabled gates the consumer UI
-- (Comment button + page). Seeded ON. Admins flip it from /admin/dials.

create table if not exists public.comments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  target_type  text not null check (target_type in ('product', 'look')),
  target_id    text not null,
  target_label text,
  body         text not null check (char_length(btrim(body)) between 1 and 2000),
  hidden       boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists comments_target_idx  on public.comments (target_type, target_id, created_at desc);
create index if not exists comments_user_idx     on public.comments (user_id);
create index if not exists comments_created_idx  on public.comments (created_at desc);

alter table public.comments enable row level security;

-- Everyone (incl. anon) can read non-hidden comments; admins read all.
drop policy if exists comments_read on public.comments;
create policy comments_read on public.comments
  for select using (
    hidden = false
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

-- A signed-in user can post comments only as themselves.
drop policy if exists comments_insert_own on public.comments;
create policy comments_insert_own on public.comments
  for insert with check (auth.uid() = user_id);

-- Owners can delete their own comment; admins can delete any.
drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments
  for delete using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

-- Only admins can update (used to hide/unhide for moderation).
drop policy if exists comments_admin_update on public.comments;
create policy comments_admin_update on public.comments
  for update using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

-- Add to the realtime publication so the comments page + admin table get
-- live inserts/deletes without polling.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comments'
  ) then
    execute 'alter publication supabase_realtime add table public.comments';
  end if;
end $$;

-- Feature flag — seeded ON. The admin /admin/dials toggle writes this key
-- via the existing app_settings_admin_write policy.
insert into public.app_settings (key, value)
values ('comments_enabled', 'true')
on conflict (key) do nothing;
