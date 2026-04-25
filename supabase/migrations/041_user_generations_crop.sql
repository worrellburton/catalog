-- Display-time crop on a finished generation. We don't re-encode the
-- video; the wizard's Crop tool just records a transform so every
-- render of the clip can apply it consistently.
--
-- crop_scale  >=1.0 -- 1.0 = no crop, 2.0 = 2x zoom, etc.
-- crop_x      -1..1 -- horizontal pan inside the cropped frame
-- crop_y      -1..1 -- vertical pan; 0/0 keeps the clip centered.

alter table public.user_generations
  add column if not exists crop_scale double precision not null default 1,
  add column if not exists crop_x     double precision not null default 0,
  add column if not exists crop_y     double precision not null default 0;

alter table public.user_generations
  drop constraint if exists user_generations_crop_scale_check;
alter table public.user_generations
  add constraint user_generations_crop_scale_check
  check (crop_scale >= 1 and crop_scale <= 4);

alter table public.user_generations
  drop constraint if exists user_generations_crop_xy_check;
alter table public.user_generations
  add constraint user_generations_crop_xy_check
  check (crop_x between -1 and 1 and crop_y between -1 and 1);

comment on column public.user_generations.crop_scale is
  'Display-time crop scale. 1.0 = no crop. The Crop tool on the result step writes here.';
