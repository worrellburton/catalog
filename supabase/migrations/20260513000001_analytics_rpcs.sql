-- product_analytics_summary(): per-product rollup of user_events
-- where target_type = 'product' (fired by trackProductClickout / ProductPage
-- impression tracking). Only returns products that have at least one event
-- to avoid listing all 700+ zero-traffic products.
--
-- brand_analytics_summary(): same source data grouped by products.brand.
-- Returns ALL brands that have products (even those with 0 events) so the
-- Brands tab gives a full catalog-coverage view.
--
-- Both functions are SECURITY DEFINER so they can cross the RLS boundary
-- on user_events. Access is limited to the authenticated role — the admin
-- panel uses the anon/authenticated Supabase client.

-- ── Product rollup ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.product_analytics_summary()
RETURNS TABLE (
  product_id        uuid,
  product_name      text,
  brand             text,
  image_url         text,
  total_impressions bigint,
  total_clicks      bigint,
  total_clickouts   bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id                                                                    AS product_id,
    p.name                                                                  AS product_name,
    p.brand,
    p.image_url,
    COUNT(*) FILTER (WHERE ue.event_type = 'impression')                    AS total_impressions,
    COUNT(*) FILTER (WHERE ue.event_type = 'click')                        AS total_clicks,
    COUNT(*) FILTER (WHERE ue.event_type = 'clickout')                     AS total_clickouts
  FROM public.products p
  LEFT JOIN public.user_events ue
    ON  ue.target_uuid = p.id
    AND ue.target_type = 'product'
  GROUP BY p.id, p.name, p.brand, p.image_url
  HAVING COUNT(ue.id) > 0
  ORDER BY
    COUNT(*) FILTER (WHERE ue.event_type = 'clickout')  DESC,
    COUNT(*) FILTER (WHERE ue.event_type = 'impression') DESC;
$$;

REVOKE ALL ON FUNCTION public.product_analytics_summary() FROM public;
GRANT EXECUTE ON FUNCTION public.product_analytics_summary() TO authenticated;

COMMENT ON FUNCTION public.product_analytics_summary() IS
  'Per-product impression / click / clickout rollup from user_events. '
  'Only returns products with at least one event. Used by the Analytics '
  'Products tab in the admin panel.';

-- ── Brand rollup ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.brand_analytics_summary()
RETURNS TABLE (
  brand             text,
  product_count     bigint,
  total_impressions bigint,
  total_clicks      bigint,
  total_clickouts   bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.brand,
    COUNT(DISTINCT p.id)                                                    AS product_count,
    COUNT(*) FILTER (WHERE ue.event_type = 'impression')                    AS total_impressions,
    COUNT(*) FILTER (WHERE ue.event_type = 'click')                        AS total_clicks,
    COUNT(*) FILTER (WHERE ue.event_type = 'clickout')                     AS total_clickouts
  FROM public.products p
  LEFT JOIN public.user_events ue
    ON  ue.target_uuid = p.id
    AND ue.target_type = 'product'
  WHERE p.brand IS NOT NULL
    AND p.brand <> ''
  GROUP BY p.brand
  ORDER BY
    COUNT(*) FILTER (WHERE ue.event_type = 'clickout')  DESC,
    COUNT(*) FILTER (WHERE ue.event_type = 'impression') DESC,
    p.brand ASC;
$$;

REVOKE ALL ON FUNCTION public.brand_analytics_summary() FROM public;
GRANT EXECUTE ON FUNCTION public.brand_analytics_summary() TO authenticated;

COMMENT ON FUNCTION public.brand_analytics_summary() IS
  'Per-brand impression / click / clickout rollup from user_events, with '
  'a product count. Returns all brands that have products (even zero-event '
  'ones). Used by the Analytics Brands tab in the admin panel.';
