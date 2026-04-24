-- Migration 033 — user_generations.age_label
--
-- Free-form age descriptor picked in the Generate wizard's new Age
-- step (e.g. "early 20s"). Seeds the Seedance prompt so the model
-- lands on the right age range when composing the subject from the
-- reference face — face photos alone often read younger or older than
-- intended.

ALTER TABLE public.user_generations
  ADD COLUMN IF NOT EXISTS age_label text;

COMMENT ON COLUMN public.user_generations.age_label IS
  'Free-form age descriptor picked in the Generate wizard (e.g. "early 20s"). Used to seed the Seedance prompt so the model lands on the right age range when composing the subject from the reference face.';
