-- Per-catalog impression counts. The consumer feed fires
-- trackImpression({ type: 'catalog', id: <slug-or-name> }) once per
-- session whenever committedQuery commits to a catalog. Admin reads
-- this via /admin/catalogs to rank by audience demand.
--
-- Returns one row per distinct catalog key (lowercased name/slug) so
-- the client can hashmap-join against the rendered list. Symmetrical
-- shape to catalog_item_metrics: current window + prior window
-- alongside each other for trend.

create or replace function public.catalog_view_counts(window_days int default 7)
returns table (
  catalog_key text,
  impressions_curr bigint,
  impressions_prev bigint
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
    sum(case when ue.created_at > now() - (window_days::text || ' days')::interval
             then 1 else 0 end)::bigint as impressions_curr,
    sum(case when ue.created_at <= now() - (window_days::text || ' days')::interval
             then 1 else 0 end)::bigint as impressions_prev
  from public.user_events ue
  where ue.target_type = 'catalog'
    and ue.event_type = 'impression'
    and ue.created_at > now() - ((2 * window_days)::text || ' days')::interval
    and coalesce(ue.target_id, ue.target_uuid::text) is not null
  group by 1;
end;
$$;

grant execute on function public.catalog_view_counts(int) to authenticated;
