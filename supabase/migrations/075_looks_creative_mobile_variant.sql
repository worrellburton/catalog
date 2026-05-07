-- 075 - Mobile-optimized variant on looks_creative.
--
-- looks_creative already carries thumbnail_url (the poster) but is
-- missing the same mobile_video_url column we added to product_creative
-- in migration 072. Without it, the consumer feed's LookTile can't pick
-- a small variant for cellular users — every look streams full-res
-- regardless of viewport.

alter table looks_creative
  add column if not exists mobile_video_url text;

comment on column looks_creative.mobile_video_url is
  'Mobile-optimized variant of video_url: 480p H.264 ~600kbps. Renderer picks this on narrow viewports / slow connections, same contract as product_creative.mobile_video_url.';
