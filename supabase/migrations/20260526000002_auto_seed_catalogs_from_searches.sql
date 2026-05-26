-- Auto-seed catalogs from consumer searches.
--
-- When a shopper search commits to a query that doesn't match an
-- existing catalog, ContinuousFeed already fires a 'catalog' impression
-- event with target_id = lower(query). This RPC takes those events and
-- materialises a draft catalog for any term that crossed a popularity
-- threshold over the lookback window — so admins see "golf" as a new
-- row to curate instead of having to spot demand in raw search logs.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING so re-runs don't duplicate.
-- Defaults to status='draft' so the new catalog doesn't show up in the
-- consumer suggestor until an admin promotes it to 'live'.

create or replace function public.auto_seed_catalogs_from_searches(
  p_window_days int default 7,
  p_min_searches int default 3
)
returns table (slug text, name text, search_count bigint)
language plpgsql
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
  with candidate as (
    select
      lower(coalesce(ue.target_id, ue.target_uuid::text)) as q,
      count(*) as n
    from public.user_events ue
    where ue.target_type = 'catalog'
      and ue.event_type = 'impression'
      and ue.created_at > now() - (p_window_days::text || ' days')::interval
      and coalesce(ue.target_id, ue.target_uuid::text) is not null
    group by 1
    having count(*) >= p_min_searches
  ),
  fresh as (
    select c.q, c.n from candidate c
    where not exists (
      select 1 from public.catalogs k where lower(k.slug) = c.q or lower(k.name) = c.q
    )
  ),
  inserted as (
    insert into public.catalogs (slug, name, status, is_featured, is_home, gender, sort_order)
    select f.q, f.q, 'draft', true, false, 'all', 0
    from fresh f
    on conflict (slug) do nothing
    returning slug, name
  )
  select i.slug, i.name, (select n from candidate c where c.q = i.slug)
  from inserted i;
end;
$$;

grant execute on function public.auto_seed_catalogs_from_searches(int, int) to authenticated;
