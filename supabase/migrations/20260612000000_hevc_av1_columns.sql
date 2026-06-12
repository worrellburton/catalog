-- HEVC HLS + AV1 MP4 variant URLs.
--
-- Additive, codec-upgrade columns alongside the existing hls_url / *_video_url
-- carriers. The encoder + backfill populate them; the client prefers them ONLY
-- where the device can decode the codec and ALWAYS falls back to the existing
-- H.264 columns when null or unsupported — so this is additive and non-breaking.
--
--   *_hls_hevc_url    — HEVC fMP4 HLS master (mobile / native-HLS path). ~15-25%
--                       smaller than the H.264 ladder; iOS AVPlayer auto-picks it.
--   *_video_av1_url   — AV1 progressive MP4 (desktop path). ~30-50% smaller than
--                       H.264; gated client-side on MediaCapabilities.
--
-- Revert: drop these columns (the *_hls_url / *_video_url columns are untouched).

alter table looks_creative
  add column if not exists hls_hevc_url text;
comment on column looks_creative.hls_hevc_url is
  'HEVC fMP4 HLS master (m3u8) for the look video. Client prefers this over hls_url where HEVC decode is available; null until backfilled. H.264 hls_url stays the fallback.';
alter table looks_creative
  add column if not exists video_av1_url text;
comment on column looks_creative.video_av1_url is
  'AV1 progressive MP4 for the look video (desktop path). Client prefers this over video_url where AV1 decode is confirmed; null until backfilled.';

alter table product_creative
  add column if not exists hls_hevc_url text;
comment on column product_creative.hls_hevc_url is
  'HEVC fMP4 HLS master (m3u8) for the creative video. Client prefers this over hls_url where HEVC decode is available; null until backfilled.';
alter table product_creative
  add column if not exists video_av1_url text;
comment on column product_creative.video_av1_url is
  'AV1 progressive MP4 for the creative video (desktop path). Client prefers this over video_url where AV1 decode is confirmed; null until backfilled.';

alter table products
  add column if not exists primary_hls_hevc_url text;
comment on column products.primary_hls_hevc_url is
  'HEVC fMP4 HLS master (m3u8) for the product''s primary video. Client prefers this over primary_hls_url where HEVC decode is available; null until backfilled.';
alter table products
  add column if not exists primary_video_av1_url text;
comment on column products.primary_video_av1_url is
  'AV1 progressive MP4 for the product''s primary video (desktop path). Client prefers this over primary_video_url where AV1 decode is confirmed; null until backfilled.';
