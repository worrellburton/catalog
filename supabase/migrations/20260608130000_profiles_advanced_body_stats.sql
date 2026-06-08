-- Advanced-mode body proportions + aesthetic on profiles.
--
-- The /generate (and /style) stats editor gains an "Advanced mode" that lets
-- the shopper record relative arm/leg length and a set of fashion-style tags.
-- These refine the generated model's silhouette + styling and are read
-- verbatim into the Seedance prompt (buildGenerationPrompt).
--
--   arm_length_label / leg_length_label : 'Short' | 'Average' | 'Long' (or null)
--   fashion_styles                      : comma-joined tag list, e.g. 'Streetwear, Minimal'

alter table public.profiles
  add column if not exists arm_length_label text,
  add column if not exists leg_length_label text,
  add column if not exists fashion_styles    text;

comment on column public.profiles.arm_length_label is
  'Advanced-mode relative arm length (Short/Average/Long); feeds the generation prompt.';
comment on column public.profiles.leg_length_label is
  'Advanced-mode relative leg length (Short/Average/Long); feeds the generation prompt.';
comment on column public.profiles.fashion_styles is
  'Advanced-mode comma-joined aesthetic tags (e.g. "Streetwear, Minimal").';
