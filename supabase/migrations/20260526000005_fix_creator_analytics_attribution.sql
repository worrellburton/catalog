-- Fix user_creator_analytics_summary() — both metrics were broken.
--
-- 1. looks_posted miscounted: the RPC counted user_generations rows
--    flagged is_published=true, but the publish flow (until commit
--    674518f) only created a new looks row and never flipped the
--    flag on the source generation, so existing live looks read
--    0 across the board. It also missed any look inserted directly
--    into the `looks` table without a corresponding generation row
--    (admin createLook, importer, etc.). Fix: count from `looks`
--    directly via user_id where status='live'.
--
-- 2. Impressions / clicks / clickouts all read 0: the join keyed
--    user_generations.id = user_events.target_uuid, but the client
--    writes target_uuid = looks.id (see services/session-tracker.ts
--    + LookCard.trackImpression). Fix: join looks instead.
--
-- Self-views still excluded. LEFT JOINs still preserve every
-- profile row so shoppers with 0 looks render '—' in the table.

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
    SELECT l.user_id, COUNT(*) AS looks_posted
    FROM public.looks l
    WHERE l.user_id IS NOT NULL
      AND l.status = 'live'
      AND l.archived_at IS NULL
    GROUP BY l.user_id
  ),
  ev AS (
    SELECT
      l.user_id AS creator_id,
      COUNT(*) FILTER (WHERE ue.event_type = 'impression') AS total_impressions,
      COUNT(*) FILTER (WHERE ue.event_type = 'click')      AS total_clicks,
      COUNT(*) FILTER (WHERE ue.event_type = 'clickout')   AS total_clickouts
    FROM public.user_events ue
    JOIN public.looks l ON l.id = ue.target_uuid
    WHERE ue.target_type = 'look'
      AND l.user_id IS NOT NULL
      AND (ue.user_id IS NULL OR ue.user_id <> l.user_id)
    GROUP BY l.user_id
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
  'Per-user creator-content rollup keyed off public.looks. looks_posted counts live, non-archived looks owned by the user. Impressions/clicks/clickouts roll up user_events with target_type=look joining looks.id = target_uuid (the actual key the client writes). Self-views excluded.';
