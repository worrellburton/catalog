-- 🔥 reactions on comments.
--
-- A single reaction kind ("fire") per (comment, user); tapping the fire
-- button toggles it on/off. Counts drive the Activity surface — hitting
-- five fires on a comment is a milestone the app celebrates.
--
-- See app/services/comments.ts (getReactionsForComments / toggleFire /
-- subscribeReactions) and app/components/CommentsPage.tsx.

create table if not exists public.comment_reactions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null default 'fire',
  created_at timestamptz not null default now(),
  unique (comment_id, user_id, kind)
);

create index if not exists comment_reactions_comment_idx
  on public.comment_reactions (comment_id);
create index if not exists comment_reactions_user_idx
  on public.comment_reactions (user_id);

alter table public.comment_reactions enable row level security;

-- Anyone can read reaction counts.
drop policy if exists comment_reactions_read on public.comment_reactions;
create policy comment_reactions_read
  on public.comment_reactions for select
  using (true);

-- Users manage only their own reactions.
drop policy if exists comment_reactions_insert_own on public.comment_reactions;
create policy comment_reactions_insert_own
  on public.comment_reactions for insert
  with check (auth.uid() = user_id);

drop policy if exists comment_reactions_delete_own on public.comment_reactions;
create policy comment_reactions_delete_own
  on public.comment_reactions for delete
  using (auth.uid() = user_id);

-- Live counts in the open thread.
alter publication supabase_realtime add table public.comment_reactions;
