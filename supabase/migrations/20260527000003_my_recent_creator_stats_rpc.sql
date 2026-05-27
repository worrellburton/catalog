-- Backs the SignInStatsPopup. Returns engagement deltas + new
-- follower count since the caller's previous_sign_in_at. Returns no
-- rows (popup skips) when:
--   - no auth context
--   - previous_sign_in_at is NULL (first session — nothing to compare against)
-- Joins user_events → looks via target_uuid (looks.id). Excludes the
-- caller's own events so a creator scrolling their own feed doesn't
-- inflate their stats.

create or replace function public.my_recent_creator_stats()
returns table(
  since               timestamptz,
  total_impressions   bigint,
  total_clicks        bigint,
  total_clickouts     bigint,
  new_followers       bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_since   timestamptz;
  v_handle  text;
begin
  if v_user_id is null then
    return;
  end if;

  select previous_sign_in_at into v_since
    from public.profiles
   where id = v_user_id;
  if v_since is null then
    return;
  end if;

  select handle into v_handle
    from public.creators
   where id = v_user_id;

  return query
  with eng as (
    select
      count(*) filter (where ue.event_type = 'impression') as total_impressions,
      count(*) filter (where ue.event_type = 'click')      as total_clicks,
      count(*) filter (where ue.event_type = 'clickout')   as total_clickouts
    from public.user_events ue
    join public.looks l on l.id = ue.target_uuid
    where l.user_id = v_user_id
      and ue.target_type = 'look'
      and ue.created_at >= v_since
      and ue.user_id <> v_user_id
  ),
  fol as (
    select count(*) as new_followers
      from public.creator_follows cf
     where v_handle is not null
       and cf.followee_handle = v_handle
       and cf.created_at >= v_since
  )
  select v_since,
         coalesce(eng.total_impressions, 0)::bigint,
         coalesce(eng.total_clicks, 0)::bigint,
         coalesce(eng.total_clickouts, 0)::bigint,
         coalesce(fol.new_followers, 0)::bigint
    from eng, fol;
end;
$$;

grant execute on function public.my_recent_creator_stats() to authenticated;
