-- Per-job model selector. Today we route requests to two Seedance 2
-- variants:
--   'fast' -> bytedance/seedance-2.0/fast/reference-to-video  (confirmed 5s)
--   'pro'  -> bytedance/seedance-2.0/pro/reference-to-video   (longer + higher quality
--                                                              when Fal exposes it;
--                                                              edge function falls
--                                                              back to /fast if the
--                                                              Pro slug 404s)
--
-- The wizard exposes the picker on the Review step. Default 'fast'
-- keeps existing rows valid.

alter table public.user_generations
  add column if not exists model text not null default 'fast';

alter table public.user_generations
  drop constraint if exists user_generations_model_check;
alter table public.user_generations
  add constraint user_generations_model_check
  check (model in ('fast', 'pro'));

comment on column public.user_generations.model is
  'Seedance 2 variant: fast (5s, /fast endpoint) or pro (longer/higher quality, falls back to fast when the Pro slug 404s).';
