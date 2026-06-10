-- Extends the existing creators.catalog_theme appearance system with a
-- particle-field toggle and a background hue. Per-creator; owner controls
-- their creators row via existing RLS.
alter table public.creators
  add column if not exists catalog_particles boolean not null default true,
  add column if not exists catalog_hue smallint;  -- 0–360, null = no tint

comment on column public.creators.catalog_particles is 'Creator catalog: show the WebGL particle field';
comment on column public.creators.catalog_hue is 'Creator catalog: background hue 0-360, null = default (no tint)';
