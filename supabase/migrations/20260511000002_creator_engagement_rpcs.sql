-- creator_engagement_since(user_id, since_ts) returns the rollup the
-- login toast uses: how many impressions / clicks / clickouts have
-- happened against the given user's looks since `since_ts`. Joins
-- user_events to user_generations via target_uuid so seed-look ids
-- (which aren't tied to a real DB row) drop out naturally.
--
-- Security definer + qualified search_path so authenticated users
-- can call it (RLS on user_events would otherwise restrict each
-- shopper to their own events, but we need the counts across every
-- shopper who saw this creator's content).

CREATE OR REPLACE FUNCTION public.creator_engagement_since(
  p_user_id uuid,
  p_since   timestamptz
)
RETURNS TABLE (
  impressions bigint,
  clicks      bigint,
  clickouts   bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*) FILTER (WHERE ue.event_type = 'impression') AS impressions,
    COUNT(*) FILTER (WHERE ue.event_type = 'click')      AS clicks,
    COUNT(*) FILTER (WHERE ue.event_type = 'clickout')   AS clickouts
  FROM public.user_events ue
  JOIN public.user_generations ug
    ON ug.id = ue.target_uuid
  WHERE ug.user_id = p_user_id
    AND ue.target_type = 'look'
    AND ue.created_at > COALESCE(p_since, ue.created_at - interval '30 days')
    AND ue.user_id <> p_user_id;
$$;

REVOKE ALL ON FUNCTION public.creator_engagement_since(uuid, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.creator_engagement_since(uuid, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.creator_engagement_since(uuid, timestamptz) IS
  'Returns {impressions, clicks, clickouts} on the given user''s looks since the given timestamp. Used by the creator login engagement toast and the Analytics section of the earnings page.';

-- Sibling RPC for the analytics section in the earnings page: same
-- counts but cumulative (no time window) plus a recent-week slice so
-- the section can render a small trend.
CREATE OR REPLACE FUNCTION public.creator_engagement_summary(
  p_user_id uuid
)
RETURNS TABLE (
  total_impressions bigint,
  total_clicks      bigint,
  total_clickouts   bigint,
  week_impressions  bigint,
  week_clicks       bigint,
  week_clickouts    bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*) FILTER (WHERE ue.event_type = 'impression') AS total_impressions,
    COUNT(*) FILTER (WHERE ue.event_type = 'click')      AS total_clicks,
    COUNT(*) FILTER (WHERE ue.event_type = 'clickout')   AS total_clickouts,
    COUNT(*) FILTER (WHERE ue.event_type = 'impression' AND ue.created_at > now() - interval '7 days') AS week_impressions,
    COUNT(*) FILTER (WHERE ue.event_type = 'click'      AND ue.created_at > now() - interval '7 days') AS week_clicks,
    COUNT(*) FILTER (WHERE ue.event_type = 'clickout'   AND ue.created_at > now() - interval '7 days') AS week_clickouts
  FROM public.user_events ue
  JOIN public.user_generations ug
    ON ug.id = ue.target_uuid
  WHERE ug.user_id = p_user_id
    AND ue.target_type = 'look'
    AND ue.user_id <> p_user_id;
$$;

REVOKE ALL ON FUNCTION public.creator_engagement_summary(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.creator_engagement_summary(uuid) TO authenticated;
