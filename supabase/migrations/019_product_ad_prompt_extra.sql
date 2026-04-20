-- Allow admins to append extra prompt text when regenerating an ad.
-- The video-generator worker reads `prompt_extra` and concatenates it onto
-- the auto-generated prompt before sending to the model.
alter table public.product_ads
  add column if not exists prompt_extra text;

comment on column public.product_ads.prompt_extra is
  'Optional extra text appended to the generated prompt at regeneration time (admin override).';
