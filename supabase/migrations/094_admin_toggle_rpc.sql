-- 094_admin_toggle_rpc.sql
-- Creates a SECURITY DEFINER RPC so the anon admin panel can flip
-- the three feed-control toggles without requiring a broad UPDATE policy
-- on the catalogs row. Anon callers can only touch the three boolean
-- columns; all other columns remain protected by RLS.

CREATE OR REPLACE FUNCTION admin_update_catalog_toggles(
  p_slug                text,
  p_filter_gender       boolean DEFAULT NULL,
  p_filter_age          boolean DEFAULT NULL,
  p_boost_top_converting boolean DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE catalogs
  SET
    filter_gender       = COALESCE(p_filter_gender,        filter_gender),
    filter_age          = COALESCE(p_filter_age,           filter_age),
    boost_top_converting = COALESCE(p_boost_top_converting, boost_top_converting)
  WHERE slug = p_slug;
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_catalog_toggles(text, boolean, boolean, boolean)
  TO anon, authenticated;
