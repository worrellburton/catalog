-- Phase 2 of the creator engagement notification feature.
-- Adds the columns we need to attribute user_events back to a creator's
-- looks and to detect "since the last time we showed the toast".

-- 1. target_uuid lets us join user_events to user_generations.id
--    directly. The existing target_id (text, numeric look id) is the
--    client-side synthetic hash; not joinable on the server.
ALTER TABLE public.user_events
  ADD COLUMN IF NOT EXISTS target_uuid uuid;

CREATE INDEX IF NOT EXISTS idx_user_events_target_uuid_created_at
  ON public.user_events (target_uuid, created_at DESC)
  WHERE target_uuid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_events_target_type_uuid
  ON public.user_events (target_type, target_uuid)
  WHERE target_uuid IS NOT NULL;

-- 2. last_creator_check_at tracks when the user last saw the
--    engagement toast. The toast queries "events since this
--    timestamp" and then stamps it forward. NULL on a fresh
--    account means "since profile creation".
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_creator_check_at timestamptz;

COMMENT ON COLUMN public.profiles.last_creator_check_at IS
  'When the user last saw the creator engagement notification toast. The toast queries impressions/clicks on the user''s looks since this timestamp, then stamps it forward.';
