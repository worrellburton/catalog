-- Safety net: keep looks.creator_handle in sync with looks.user_id.
-- The Generate → Publish flow overwrites user_id to the persona's
-- profile id but used to leave creator_handle NULL, so persona looks
-- never surfaced on /c/<handle>. Trigger fires on INSERT and on any
-- UPDATE that touches user_id; never overwrites an explicit value.

create or replace function public.looks_sync_creator_handle()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is not null and (new.creator_handle is null or new.creator_handle = '') then
    select handle into new.creator_handle from public.creators where id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists looks_sync_creator_handle_ins on public.looks;
create trigger looks_sync_creator_handle_ins
  before insert on public.looks
  for each row execute function public.looks_sync_creator_handle();

drop trigger if exists looks_sync_creator_handle_upd on public.looks;
create trigger looks_sync_creator_handle_upd
  before update of user_id on public.looks
  for each row
  when (new.user_id is distinct from old.user_id)
  execute function public.looks_sync_creator_handle();
