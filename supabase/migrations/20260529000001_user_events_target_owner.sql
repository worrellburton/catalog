-- Denormalize the look owner onto user_events so the Activity realtime
-- toast can subscribe with a SERVER-SIDE filter instead of relying on
-- Realtime authorizing a cross-table-subquery RLS policy per row (which
-- it doesn't do reliably). This is what was silently breaking the
-- "someone viewed/tapped your look" realtime toast: the row was created
-- and visible to a normal RLS query (catch-up worked), but the realtime
-- channel never delivered it.
--
-- Adds:
--   • user_events.target_owner_id  — the user_id of the look the event
--     targets (NULL for non-look events).
--   • a BEFORE INSERT trigger that populates it for look events.
--   • a backfill for existing rows.
--   • a partial index for fast owner-scoped reads (catch-up).
--   • a simple `auth.uid() = target_owner_id` SELECT policy that Realtime
--     CAN evaluate, so a filtered subscription authorizes cleanly.

alter table public.user_events
  add column if not exists target_owner_id uuid;

-- Backfill existing look events with their look's owner.
update public.user_events e
set target_owner_id = l.user_id
from public.looks l
where e.target_type = 'look'
  and e.target_uuid = l.id
  and e.target_owner_id is null;

-- Populate on every future insert. SECURITY DEFINER so the lookup
-- isn't blocked by RLS on looks for the inserting (non-owner) user.
create or replace function public.set_user_event_target_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.target_owner_id is null
     and new.target_type = 'look'
     and new.target_uuid is not null then
    select user_id into new.target_owner_id
    from public.looks
    where id = new.target_uuid;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_user_event_target_owner on public.user_events;
create trigger trg_set_user_event_target_owner
  before insert on public.user_events
  for each row execute function public.set_user_event_target_owner();

-- Fast owner-scoped reads for the catch-up summaries.
create index if not exists idx_user_events_target_owner
  on public.user_events (target_owner_id, created_at desc)
  where target_owner_id is not null;

-- Simple, realtime-evaluable SELECT policy: a creator can read events
-- that target them. Coexists (OR) with the existing owner/admin/creator
-- policies; this is the one a filtered realtime subscription relies on.
drop policy if exists user_events_target_owner_select on public.user_events;
create policy user_events_target_owner_select on public.user_events
  for select
  using (auth.uid() = target_owner_id);
