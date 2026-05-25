-- Per-catalog DAILY impression breakdown for the admin table's
-- inline sparkline column. One row per (catalog_key, day) so the
-- client groups them into per-catalog series cheaply. Days with
-- zero activity aren't returned — the client fills in zeros
-- between the first and last seen day.

create or replace function public.catalog_view_counts_daily(window_days int default 14)
returns table (
  catalog_key text,
  day date,
  impressions bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (is_admin = true or role in ('admin', 'super_admin'))
  ) then
    raise exception 'Admin privileges required' using errcode = '42501';
  end if;

  return query
  select
    lower(coalesce(ue.target_id, ue.target_uuid::text)) as catalog_key,
    ue.created_at::date as day,
    count(*)::bigint as impressions
  from public.user_events ue
  where ue.target_type = 'catalog'
    and ue.event_type = 'impression'
    and ue.created_at > now() - (window_days::text || ' days')::interval
    and coalesce(ue.target_id, ue.target_uuid::text) is not null
  group by 1, 2;
end;
$$;

grant execute on function public.catalog_view_counts_daily(int) to authenticated;
