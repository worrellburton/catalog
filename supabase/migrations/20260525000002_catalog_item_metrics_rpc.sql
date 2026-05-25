-- Phase 1 of the catalog admin premium-experience build.
-- Single RPC every later phase (per-tile pills, trend arrows, sort,
-- filter, KPI strip, detail drawer, health report) reads from. Returns
-- per-look and per-product event counts for two adjacent equal-length
-- windows so the caller can compute trend without a second roundtrip.
--
-- target_key is target_uuid when present (newer events), falling back
-- to target_id (legacy events). Caller does the join client-side
-- against the looks/products rows already in memory — keeps the RPC
-- cheap and avoids RLS recursion through public.looks.

create or replace function public.catalog_item_metrics(window_days int default 7)
returns table (
  target_type text,
  target_key text,
  impressions_curr bigint,
  clicks_curr bigint,
  clickouts_curr bigint,
  impressions_prev bigint,
  clicks_prev bigint,
  clickouts_prev bigint
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
  with e as (
    select
      ue.target_type,
      coalesce(ue.target_uuid::text, ue.target_id) as target_key,
      ue.event_type,
      ue.created_at
    from public.user_events ue
    where ue.created_at > now() - ((2 * window_days)::text || ' days')::interval
      and ue.target_type in ('look', 'product', 'product_url')
      and coalesce(ue.target_uuid::text, ue.target_id) is not null
  )
  select
    e.target_type,
    e.target_key,
    sum(case when e.event_type = 'impression'
              and e.created_at > now() - (window_days::text || ' days')::interval
             then 1 else 0 end)::bigint as impressions_curr,
    sum(case when e.event_type in ('click', 'clickout')
              and e.created_at > now() - (window_days::text || ' days')::interval
             then 1 else 0 end)::bigint as clicks_curr,
    sum(case when e.event_type = 'clickout'
              and e.created_at > now() - (window_days::text || ' days')::interval
             then 1 else 0 end)::bigint as clickouts_curr,
    sum(case when e.event_type = 'impression'
              and e.created_at <= now() - (window_days::text || ' days')::interval
             then 1 else 0 end)::bigint as impressions_prev,
    sum(case when e.event_type in ('click', 'clickout')
              and e.created_at <= now() - (window_days::text || ' days')::interval
             then 1 else 0 end)::bigint as clicks_prev,
    sum(case when e.event_type = 'clickout'
              and e.created_at <= now() - (window_days::text || ' days')::interval
             then 1 else 0 end)::bigint as clickouts_prev
  from e
  group by 1, 2;
end;
$$;

grant execute on function public.catalog_item_metrics(int) to authenticated;

-- Spot index for the time-range scan. Cheap insurance — user_events
-- grows linearly and the RPC always filters by created_at.
create index if not exists user_events_created_target_idx
  on public.user_events (created_at desc, target_type)
  where target_type in ('look', 'product', 'product_url');
