-- Video delivery pipeline dials (admin → /admin/dials → "Video delivery").
--
-- The consumer video grid runs on one of two independent delivery paths,
-- switchable live from the admin panel:
--   video_pipeline_mode = 'hls'  → adaptive ladder (hls_url/primary_hls_url,
--                                  hls.js / native HLS, head-warm prewarm)
--   video_pipeline_mode = 'mp4'  → legacy progressive MP4 path (video_url/
--                                  mobile_video_url, full-file prewarm into
--                                  the browser HTTP cache)
-- Plus the shared prewarm/cache knobs. All read by the client through
-- app/services/video-pipeline.ts (module cache + localStorage snapshot +
-- realtime; app_settings is already in the realtime publication per
-- 20260606130000_app_settings_realtime_publication.sql).
--
-- Seeding is documentation/visibility only — a missing row falls back to
-- the same defaults in code, so this migration is safe to skip-and-retry.

INSERT INTO app_settings (key, value) VALUES
  ('video_pipeline_mode', 'hls'),
  ('video_prewarm_enabled', 'true'),
  ('video_prewarm_concurrency', '4'),
  ('video_prewarm_queue_cap', '10'),
  ('video_hls_warm_segments', '2'),
  ('video_prewarm_cache_mode', 'default')
ON CONFLICT (key) DO NOTHING;
