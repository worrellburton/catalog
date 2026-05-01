-- 066: Fix product_creative auto-embed trigger to also fire for status='done'.
--
-- Migration 060 set the guard to status='live', but the video generation
-- pipeline (generate-look / fal-webhook) now sets status='done' when a
-- creative finishes generating. 'live' rows are older backfill data.
-- The fix: accept status IN ('live', 'done') so the trigger fires regardless
-- of which terminal status the pipeline writes.

CREATE OR REPLACE FUNCTION notify_embed_creative()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_token text;
BEGIN
  -- Fire when the creative has a video, is in a terminal state, and hasn't
  -- been embedded yet.
  IF NEW.status IN ('live', 'done')
     AND NEW.video_url IS NOT NULL
     AND NEW.text_embedding IS NULL
  THEN
    SELECT decrypted_secret INTO v_token
      FROM vault.decrypted_secrets
     WHERE name = 'embed_entity_service_key'
     LIMIT 1;

    -- Skip silently if vault secret not set yet; nightly backfill will catch it.
    IF v_token IS NULL OR v_token = 'PLACEHOLDER_REPLACE_VIA_DASHBOARD' THEN
      RETURN NEW;
    END IF;

    PERFORM net.http_post(
      url     := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/embed-entity',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_token
      ),
      body    := jsonb_build_object(
        'id',          NEW.id,
        'entity_type', 'creative',
        'force',       false
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION notify_embed_creative() IS
  'Fires embed-entity(creative) when a product_creative row reaches status=live or status=done with a video_url and no text_embedding yet. Fixed in 066 to accept done status.';
