-- Extend user_creator_analytics_summary so clickouts on products
-- DISCOVERED VIA a creator's look attribute back to that creator.
-- Clickouts are written as target_type='product', so the old RPC
-- (which only matched target_type='look') always read 0 for
-- creator clickouts. Join look_products to credit every look that
-- contains the clicked product.

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
  ev_look AS (
    SELECT
      l.user_id AS creator_id,
      COUNT(*) FILTER (WHERE ue.event_type = 'impression') AS impressions,
      COUNT(*) FILTER (WHERE ue.event_type = 'click')      AS clicks,
      COUNT(*) FILTER (WHERE ue.event_type = 'clickout')   AS clickouts
    FROM public.user_events ue
    JOIN public.looks l ON l.id = ue.target_uuid
    WHERE ue.target_type = 'look'
      AND l.user_id IS NOT NULL
      AND (ue.user_id IS NULL OR ue.user_id <> l.user_id)
    GROUP BY l.user_id
  ),
  ev_product_clickouts AS (
    SELECT
      l.user_id AS creator_id,
      COUNT(*) AS clickouts
    FROM public.user_events ue
    JOIN public.look_products lp ON lp.product_id = ue.target_uuid
    JOIN public.looks l ON l.id = lp.look_id
    WHERE ue.event_type = 'clickout'
      AND ue.target_type = 'product'
      AND l.user_id IS NOT NULL
      AND l.status = 'live'
      AND l.archived_at IS NULL
      AND (ue.user_id IS NULL OR ue.user_id <> l.user_id)
    GROUP BY l.user_id
  )
  SELECT
    p.id                                                                AS user_id,
    p.full_name,
    p.email,
    p.avatar_url,
    p.role,
    p.created_at,
    p.last_sign_in_at,
    COALESCE(posted.looks_posted, 0)                                    AS looks_posted,
    COALESCE(ev_look.impressions, 0)                                    AS total_impressions,
    COALESCE(ev_look.clicks,      0)                                    AS total_clicks,
    COALESCE(ev_look.clickouts,   0) + COALESCE(ev_product_clickouts.clickouts, 0) AS total_clickouts
  FROM public.profiles p
  LEFT JOIN posted ON posted.user_id  = p.id
  LEFT JOIN ev_look ON ev_look.creator_id   = p.id
  LEFT JOIN ev_product_clickouts ON ev_product_clickouts.creator_id = p.id
  ORDER BY p.last_sign_in_at DESC NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.user_creator_analytics_summary() FROM public;
GRANT EXECUTE ON FUNCTION public.user_creator_analytics_summary() TO authenticated;

COMMENT ON FUNCTION public.user_creator_analytics_summary() IS
  'Per-user creator-content rollup. looks_posted counts live looks. Impressions/clicks count look-target events; clickouts add product-target clickouts attributed via look_products. Self-events excluded.';
