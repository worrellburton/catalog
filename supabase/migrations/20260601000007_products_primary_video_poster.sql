-- Primary-video poster: a still frame extracted from the generated
-- primary video, at the video's exact dimensions (3:4). The async
-- primary-video pipeline (generate-primary-video → fal-webhook) only
-- stores primary_video_url; the feed then fell back to the square
-- primary_image_url as the <video> poster, which object-fit:cover
-- magnified ~33% into the 3:4 card (the "zoomed in" product look).
--
-- Populating this column with the video's own first frame gives the
-- poster the same aspect ratio as the clip, so poster and video fill
-- the card identically — no crop-zoom, no swap jump. Backfilled by
-- agents/video-generator/backfill_creative_assets.py --table products.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS primary_video_poster_url text;

COMMENT ON COLUMN products.primary_video_poster_url IS
  'Still frame extracted from primary_video_url at the video''s native 3:4 size. Used as the feed poster so it matches the clip without crop-zoom.';
