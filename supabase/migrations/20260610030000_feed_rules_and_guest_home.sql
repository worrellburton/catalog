-- Daily-feed rules + the signed-out landing screen.
--
-- 1. guest-home catalog: a second pinned LANDING SCREEN row in /admin/catalogs
--    — the home screen for unregistered users (one shared feed, curated here).
-- 2. trending_product_scores RPC: platform-wide engagement velocity for the
--    "trending this week" feed rule (personalize-feed edge function).

INSERT INTO catalogs (slug, name, description, gender, status, is_featured, is_home, sort_order)
VALUES ('guest-home', 'Home for unregistered users',
        'What signed-out visitors see first — one shared landing feed.',
        'all', 'live', false, false, 0)
ON CONFLICT (slug) DO UPDATE
  SET status = 'live', sort_order = 0;

CREATE OR REPLACE FUNCTION trending_product_scores(days int DEFAULT 7, lim int DEFAULT 200)
RETURNS TABLE(product_id text, score numeric)
LANGUAGE sql STABLE AS $$
  SELECT target_uuid AS product_id,
         SUM(CASE lower(event_type)
               WHEN 'clickout' THEN 3
               WHEN 'click' THEN 1
               ELSE 0.2 END)::numeric AS score
  FROM user_events
  WHERE target_type = 'product'
    AND target_uuid IS NOT NULL
    AND created_at > now() - make_interval(days => days)
  GROUP BY target_uuid
  ORDER BY 2 DESC
  LIMIT lim;
$$;
