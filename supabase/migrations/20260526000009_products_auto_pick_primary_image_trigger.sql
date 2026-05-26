-- Auto-fire pick-primary-image whenever a product lands with image
-- content and hasn't been processed yet. Two triggering moments:
--   1. INSERT — product inserted with images already populated
--      (Google Shopping bulk ingest, Amazon ingest)
--   2. UPDATE — scraper completed and stamped scrape_status='done' or
--      appended to images / image_url
--
-- The trigger is idempotent — once primary_image_picked_at is set,
-- subsequent UPDATEs are no-ops.

CREATE OR REPLACE FUNCTION public.notify_pick_primary_image()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_token  text;
  v_urls   jsonb;
  v_count  integer;
BEGIN
  IF NEW.primary_image_picked_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  WITH urls AS (
    SELECT DISTINCT value::text AS url
    FROM jsonb_array_elements_text(COALESCE(NEW.images, '[]'::jsonb)) AS value
    WHERE length(value::text) > 0
    UNION
    SELECT NEW.image_url
    WHERE NEW.image_url IS NOT NULL AND length(NEW.image_url) > 0
  )
  SELECT jsonb_agg(url ORDER BY url), count(*)
    INTO v_urls, v_count
  FROM (SELECT url FROM urls LIMIT 8) AS capped;

  IF v_count IS NULL OR v_count = 0 THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO v_token
    FROM vault.decrypted_secrets
   WHERE name = 'embed_entity_service_key'
   LIMIT 1;

  IF v_token IS NULL OR v_token = 'PLACEHOLDER_REPLACE_VIA_DASHBOARD' THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/pick-primary-image',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_token
    ),
    body    := jsonb_build_object(
      'product_id', NEW.id,
      'name',       COALESCE(NEW.name,  ''),
      'brand',      COALESCE(NEW.brand, ''),
      'image_urls', v_urls
    )
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_pick_primary_image() IS
  'Fires pick-primary-image whenever a product lands with images and no primary pick yet. Wired by trg_products_auto_pick_primary.';

DROP TRIGGER IF EXISTS trg_products_auto_pick_primary ON public.products;

CREATE TRIGGER trg_products_auto_pick_primary
  AFTER INSERT OR UPDATE OF images, image_url, scrape_status
  ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_pick_primary_image();
