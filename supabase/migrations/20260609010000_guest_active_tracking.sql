-- Guest (signed-out) activity tracking, to split admin DAU into
-- registered vs unregistered. One row per guest device (client_id is a
-- random id the client keeps in localStorage); last_seen_at bumps on each
-- ping. "Active in window" = last_seen_at >= window start, distinct device
-- = distinct client_id (the PK). All access via SECURITY DEFINER RPCs so
-- the table needs no broad anon RLS.

create table if not exists public.guest_sessions (
  client_id     text primary key,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

alter table public.guest_sessions enable row level security;
-- No direct policies: reads/writes go through the RPCs below only.

-- Upsert a guest device's heartbeat. Ignores malformed ids.
create or replace function public.guest_ping(p_client_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_client_id is null or length(p_client_id) < 8 or length(p_client_id) > 64 then
    return;
  end if;
  insert into public.guest_sessions (client_id, first_seen_at, last_seen_at)
  values (p_client_id, now(), now())
  on conflict (client_id) do update set last_seen_at = now();
end;
$$;

-- Distinct guest devices active since p_since (for the admin DAU split).
create or replace function public.guest_active_count(p_since timestamptz)
returns integer
language sql
security definer
set search_path = public
as $$
  select count(*)::int from public.guest_sessions where last_seen_at >= p_since;
$$;

grant execute on function public.guest_ping(text)              to anon, authenticated;
grant execute on function public.guest_active_count(timestamptz) to anon, authenticated;
