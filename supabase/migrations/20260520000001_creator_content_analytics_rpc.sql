-- user_creator_analytics_summary() — companion to user_analytics_summary
-- for the admin /analytics page. Where the existing shopper view shows
-- what each user did while browsing, this one shows what each user's
-- published looks earned: how many they've posted and the impressions /
-- clicks / clickouts those looks attracted from other shoppers.
--
-- Attribution mirrors the in-app creator engagement RPCs
-- (20260511000002_creator_engagement_rpcs.sql): user_events joins
-- user_generations via target_uuid with target_type='look'. Self-views
-- are excluded so a creator scrolling their own feed doesn't inflate
-- their numbers.
--
-- LEFT JOINs preserve every profile, so the admin table can list
-- shoppers with 0 looks (the UI renders '—' for them).

CREATE OR REPLACE FUNCTION public.user_creator_analytics_summary()
RETURNS TABLE (
  user_id           uuid,
  full_name         text,
  email             text,
  avatar_url        text,
  role              text,
  created_at        timestamptz,
  last_sign_in_at   timestamptz,
  looks_posted      bigint,
  total_impressions bigint,
  total_clicks      bigint,
  total_clickouts   bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH posted AS (
    SELECT ug.user_id, COUNT(*) AS looks_posted
    FROM public.user_generations ug
    WHERE ug.is_published = true
    GROUP BY ug.user_id
  ),
  ev AS (
    SELECT
      ug.user_id AS creator_id,
      COUNT(*) FILTER (WHERE ue.event_type = 'impression') AS total_impressions,
      COUNT(*) FILTER (WHERE ue.event_type = 'click')      AS total_clicks,
      COUNT(*) FILTER (WHERE ue.event_type = 'clickout')   AS total_clickouts
    FROM public.user_events ue
    JOIN public.user_generations ug ON ug.id = ue.target_uuid
    WHERE ue.target_type = 'look'
      AND ue.user_id <> ug.user_id
    GROUP BY ug.user_id
  )
  SELECT
    p.id                              AS user_id,
    p.full_name,
    p.email,
    p.avatar_url,
    p.role,
    p.created_at,
    p.last_sign_in_at,
    COALESCE(posted.looks_posted,  0) AS looks_posted,
    COALESCE(ev.total_impressions, 0) AS total_impressions,
    COALESCE(ev.total_clicks,      0) AS total_clicks,
    COALESCE(ev.total_clickouts,   0) AS total_clickouts
  FROM public.profiles p
  LEFT JOIN posted ON posted.user_id  = p.id
  LEFT JOIN ev     ON ev.creator_id   = p.id
  ORDER BY p.last_sign_in_at DESC NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.user_creator_analytics_summary() FROM public;
GRANT EXECUTE ON FUNCTION public.user_creator_analytics_summary() TO authenticated;

COMMENT ON FUNCTION public.user_creator_analytics_summary() IS
  'Per-user creator-content rollup: looks posted plus impressions/clicks/clickouts on the user''s published looks (self-views excluded). Powers the Creator sub-toggle on the admin Users analytics tab.';
