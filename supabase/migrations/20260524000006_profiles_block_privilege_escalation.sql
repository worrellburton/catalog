-- Server-side admin RBAC enforcement.
--
-- profiles_self_update (RLS) lets a signed-in user update their own
-- row — necessary for the Edit profile flow (name/height/weight/etc).
-- The same policy also lets the user update privileged columns
-- (is_admin, role), so any shopper could promote themselves to admin
-- by sending an UPDATE with is_admin=true on their own profile row.
--
-- This trigger fires BEFORE every UPDATE and blocks changes to those
-- two columns unless the caller is the service role OR is already an
-- admin. Defense-in-depth alongside the existing client gates.

create or replace function public.profiles_block_privilege_escalation()
returns trigger
language plpgsql
security invoker
as $$
declare
  caller_role text;
begin
  -- Service role + supabase-internal callers bypass; only enforce
  -- on authenticated users.
  begin
    caller_role := current_setting('request.jwt.claims', true)::json ->> 'role';
  exception when others then
    caller_role := null;
  end;
  if caller_role = 'service_role' then
    return new;
  end if;

  -- Both columns are guarded. Comparing IS DISTINCT FROM so NULL
  -- transitions on the rare role=null row are handled correctly.
  if (new.is_admin is distinct from old.is_admin)
    or (new.role is distinct from old.role) then
    if not exists (
      select 1 from public.profiles
      where id = auth.uid()
        and (is_admin = true or role in ('admin', 'super_admin'))
    ) then
      raise exception 'Insufficient privileges to modify is_admin or role'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_block_privilege_escalation on public.profiles;
create trigger profiles_block_privilege_escalation
  before update on public.profiles
  for each row execute function public.profiles_block_privilege_escalation();
