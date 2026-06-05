-- The public creator catalog (/c/<handle>) filters looks by creator_handle,
-- so any live look with a null creator_handle silently disappears from the
-- page. The fill function looks_sync_creator_handle() already backfills the
-- handle from the owner's creators row, but the UPDATE trigger only fired
-- when user_id CHANGED — so a look whose handle was nulled (the
-- generation→archived auto-add path does this) while keeping the same owner
-- never got re-populated, and never showed up when set live.
--
-- Broaden the trigger to also fire when creator_handle or status changes.
-- The fill function is idempotent (only acts when creator_handle is null/''),
-- so this is safe and cheap.
drop trigger if exists looks_sync_creator_handle_upd on public.looks;
create trigger looks_sync_creator_handle_upd
  before update of user_id, creator_handle, status on public.looks
  for each row execute function public.looks_sync_creator_handle();

-- Safety backfill for any rows currently missing a handle.
update public.looks l
set creator_handle = c.handle
from public.creators c
where l.user_id = c.id and (l.creator_handle is null or l.creator_handle = '') and c.handle is not null;
