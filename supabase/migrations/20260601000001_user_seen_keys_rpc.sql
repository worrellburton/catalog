-- Per-user "seen" set for the consumer feed. Returns the distinct
-- look/product keys the CURRENT user (auth.uid()) has logged an
-- impression for. Used to hide already-seen thumbnails on re-login;
-- once a user has seen everything the client resets and shows them
-- again. SECURITY DEFINER but scoped strictly to auth.uid()'s own rows,
-- so it leaks nothing — a caller can only read what they themselves saw.
create or replace function public.user_seen_keys()
returns table(target_type text, target_key text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select distinct
    ue.target_type,
    coalesce(ue.target_uuid::text, ue.target_id) as target_key
  from public.user_events ue
  where ue.user_id = auth.uid()
    and ue.event_type = 'impression'
    and ue.target_type in ('look', 'product')
    and coalesce(ue.target_uuid::text, ue.target_id) is not null;
$function$;

grant execute on function public.user_seen_keys() to anon, authenticated;
