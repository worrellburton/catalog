-- Migration 032 — user_generations.fal_request_id
--
-- Stores the Fal queue request_id we submitted under so the
-- fal-webhook function can look up the parent row when Fal calls back
-- (we no longer poll synchronously in generate-look). The partial
-- index keeps the table lean — only generating rows have a value.

ALTER TABLE public.user_generations
  ADD COLUMN IF NOT EXISTS fal_request_id text;

CREATE INDEX IF NOT EXISTS user_generations_fal_request_id_idx
  ON public.user_generations(fal_request_id)
  WHERE fal_request_id IS NOT NULL;

COMMENT ON COLUMN public.user_generations.fal_request_id IS
  'Fal queue request_id we submitted under. Saved so the fal-webhook function can look up the parent row when Fal calls back, and so a recovery job can poll Fal for orphaned generations.';
