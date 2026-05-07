-- Persist the shopper's height + age picks from the generate wizard so
-- they're prefilled the next session and the look-generation pipeline
-- can reference them downstream.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS height_cm    integer,
  ADD COLUMN IF NOT EXISTS height_label text,
  ADD COLUMN IF NOT EXISTS age_label    text;
