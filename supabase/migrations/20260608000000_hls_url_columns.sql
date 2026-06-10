-- HLS adaptive-bitrate manifest URLs.
--
-- Adds the master-playlist column to the creative carriers so the player can
-- serve ONE adaptive source per clip (480p/720p/1080p ladder) instead of a
-- fixed mobile/full MP4. The encoder + backfill populate these; the client
-- prefers them (look.hls_url / pickPlaybackSource) and falls back to the
-- existing MP4 columns when null, so this is additive and non-breaking.

alter table looks_creative
  add column if not exists hls_url text;
comment on column looks_creative.hls_url is
  'HLS master playlist (m3u8) for the look video — adaptive 480p/720p/1080p ladder. Client prefers this over video_url/mobile_video_url; null until backfilled.';

alter table product_creative
  add column if not exists hls_url text;
comment on column product_creative.hls_url is
  'HLS master playlist (m3u8) for the creative video — adaptive ladder. Client prefers this over video_url/mobile_video_url; null until backfilled.';

alter table products
  add column if not exists primary_hls_url text;
comment on column products.primary_hls_url is
  'HLS master playlist (m3u8) for the product''s primary video — adaptive ladder. Client prefers this over primary_video_url; null until backfilled.';
