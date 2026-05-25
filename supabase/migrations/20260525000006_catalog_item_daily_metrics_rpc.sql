-- Per-item per-day event counts for the catalog admin detail drawer
-- sparkline. Returns one row per day in the window (gap-filled), so
-- the client renders a clean bar chart without zero-day holes.

create or replace function public.catalog_item_daily_metrics(
  p_target_type text,
  p_target_key text,
  p_days int default 14
)
returns table (
  day date,
  impressions bigint,
  clicks bigint,
  clickouts bigint
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

  if p_target_type not in ('look', 'product', 'catalog') then
    raise exception 'target_type must be look / product / catalog'
      using errcode = '22023';
  end if;

  return query
  with days as (
    select generate_series(
      (current_date - (p_days - 1) * interval '1 day')::date,
      current_date,
      '1 day'::interval
    )::date as day
  ),
  events as (
    select
      ue.created_at::date as day,
      ue.event_type
    from public.user_events ue
    where ue.target_type = p_target_type
      and coalesce(ue.target_uuid::text, ue.target_id) = p_target_key
      and ue.created_at > now() - ((p_days + 1)::text || ' days')::interval
  )
  select
    d.day,
    coalesce(sum(case when e.event_type = 'impression' then 1 else 0 end), 0)::bigint as impressions,
    coalesce(sum(case when e.event_type in ('click', 'clickout') then 1 else 0 end), 0)::bigint as clicks,
    coalesce(sum(case when e.event_type = 'clickout' then 1 else 0 end), 0)::bigint as clickouts
  from days d
  left join events e on e.day = d.day
  group by d.day
  order by d.day;
end;
$$;

grant execute on function public.catalog_item_daily_metrics(text, text, int) to authenticated;
