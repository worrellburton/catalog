-- Keep creators.avatar_url in sync with the owning user's profile avatar.
--
-- A real-user creator's `creators` row is seeded at signup with whatever
-- avatar was available then (often a Google photo). When the user later
-- uploads a new avatar it lands on `profiles.avatar_url` only, so every
-- surface that reads `creators.avatar_url` (the search suggestion, the
-- TypeAnywhere bar, getCreators consumers) kept showing the stale one —
-- even though the creator catalog + following rail (which prefer the
-- profile avatar) show the fresh one.
--
-- The `creators` table has no user_id, but `looks` links a handle to its
-- owner (creator_handle ↔ user_id). We use that mapping to (1) backfill
-- existing rows and (2) keep them synced via a trigger on profile avatar
-- changes.

-- ── 1. One-time backfill ──────────────────────────────────────────────
with owner as (
  select distinct on (l.creator_handle) l.creator_handle as handle, l.user_id
  from looks l
  where l.user_id is not null and l.creator_handle is not null
  order by l.creator_handle, l.created_at desc
)
update creators c
set avatar_url = p.avatar_url, updated_at = now()
from owner o
join profiles p on p.id = o.user_id
where c.handle = o.handle
  and p.avatar_url is not null
  and p.avatar_url is distinct from c.avatar_url;

-- ── 2. Keep it fresh on future avatar uploads ─────────────────────────
create or replace function public.sync_creator_avatar_from_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.avatar_url is distinct from old.avatar_url and new.avatar_url is not null then
    update creators c
    set avatar_url = new.avatar_url, updated_at = now()
    where c.handle in (
      select distinct l.creator_handle
      from looks l
      where l.user_id = new.id and l.creator_handle is not null
    )
    and c.avatar_url is distinct from new.avatar_url;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_creator_avatar on public.profiles;
create trigger trg_sync_creator_avatar
after update of avatar_url on public.profiles
for each row execute function public.sync_creator_avatar_from_profile();
