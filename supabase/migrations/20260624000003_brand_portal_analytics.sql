-- Brand portal analytics (Phase 4) — ONE brand-scoped, membership-gated RPC that
-- collapses the old 6-endpoint analytics fanout. Aggregates user_events
-- (impression/click/clickout on the brand's products) over a day window and
-- returns totals + a daily series as JSON.
--
-- SECURITY DEFINER but it raises unless the caller is a member of the brand (or
-- a platform admin) — so a brand user only ever sees their own brand's numbers,
-- never every brand's (which the existing brand_analytics_summary() exposes).

create or replace function public.brand_portal_analytics(p_brand_id uuid, p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days   int := greatest(1, least(coalesce(p_days, 30), 3650));
  v_since  timestamptz := now() - make_interval(days => v_days);
  v_result jsonb;
begin
  if not (public.is_brand_member(p_brand_id) or public.is_platform_admin()) then
    raise exception 'not authorized for brand %', p_brand_id using errcode = '42501';
  end if;

  with ev as (
    select ue.event_type, ue.created_at
    from public.user_events ue
    join public.products p on p.id = ue.target_uuid
    where ue.target_type = 'product'
      and p.brand_id = p_brand_id
      and ue.created_at >= v_since
  ),
  daily as (
    select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
           count(*) filter (where event_type = 'impression') as impressions,
           count(*) filter (where event_type = 'click')      as clicks,
           count(*) filter (where event_type = 'clickout')   as clickouts
    from ev
    group by 1
    order by 1
  )
  select jsonb_build_object(
    'days',          v_days,
    'product_count', (select count(*) from public.products where brand_id = p_brand_id),
    'impressions',   (select count(*) from ev where event_type = 'impression'),
    'clicks',        (select count(*) from ev where event_type = 'click'),
    'clickouts',     (select count(*) from ev where event_type = 'clickout'),
    'daily',         coalesce((
                       select jsonb_agg(jsonb_build_object(
                         'day', day, 'impressions', impressions, 'clicks', clicks, 'clickouts', clickouts))
                       from daily), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.brand_portal_analytics(uuid, integer) to authenticated;
