-- Adds "polish" tracking to products.primary_image_url.
--
-- Polishing reframes the existing primary image into a standardized
-- e-commerce 5:4 packshot via fal.ai's nano-banana-2/edit pipeline.
-- Three columns track the lifecycle so the admin UI can distinguish
-- "raw scrape" primaries from "polished" primaries and so we keep a
-- one-step revert path back to the original URL.

alter table public.products
  add column if not exists primary_image_polished       boolean     not null default false,
  add column if not exists primary_image_polished_at    timestamptz,
  add column if not exists primary_image_pre_polish_url text;

comment on column public.products.primary_image_polished is
  'true once the primary_image_url has been reframed by polish-primary-image.';
comment on column public.products.primary_image_pre_polish_url is
  'Original primary_image_url before polish — kept so a polish can be reverted.';
