-- Primary video lifecycle on public.products. Mirrors the
-- primary_image_url shape: a single chosen URL + bookkeeping so the
-- admin UI can show "polish-style" generate affordances on rows that
-- don't have one yet.

alter table public.products
  add column if not exists primary_video_url              text,
  add column if not exists primary_video_generated_at     timestamptz,
  add column if not exists primary_video_source_image_url text;

comment on column public.products.primary_video_url is
  'Short cinematic-motion video of the product, generated from primary_image_url.';
comment on column public.products.primary_video_source_image_url is
  'Snapshot of the image URL that was fed to the i2v model — kept so re-runs are reproducible.';
