-- Add weight to the user-stats triad alongside height + age. Stored in
-- kilograms (numeric for cm-equivalent precision) plus a free-text
-- label the model hears verbatim in the Seedance/Veo prompt. Same
-- shape as the existing height_cm + height_label pair so the wizard,
-- StatsEditorModal, and admin detail page can mirror the height
-- plumbing one-for-one.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS weight_kg numeric(5,1),
  ADD COLUMN IF NOT EXISTS weight_label text;

COMMENT ON COLUMN public.profiles.weight_kg IS
  'Self-reported weight in kilograms, rounded to one decimal. Null when the user has not set it. Used by /generate to build a body-shape clause for the Seedance/Veo prompt so the rendered subject reads at the right build.';
COMMENT ON COLUMN public.profiles.weight_label IS
  'Human label the model hears verbatim (e.g. "165 lb" / "75 kg"). Single source of truth — the wizard and the admin editor read this string out instead of formatting weight_kg on the fly, so a future units swap stays consistent.';

ALTER TABLE public.user_generations
  ADD COLUMN IF NOT EXISTS weight_label text;

COMMENT ON COLUMN public.user_generations.weight_label IS
  'Frozen weight phrase captured at submit time so the generate-look prompt is reproducible even if the profile changes mid-flight. Null for legacy rows.';
