-- Per-device video delivery pipeline (admin → /admin/dials).
--
-- The single global 'video_pipeline_mode' dial is now the DESKTOP pipeline.
-- This adds the matching MOBILE dial so phones (and the native app webview,
-- which is phone-width) can run a different delivery path from desktop browsers:
--
--   video_pipeline_mode        → desktop (>768px)  — default mp4 in code
--                                (DEFAULT_DESKTOP_PIPELINE_MODE). The desktop row
--                                was first created by 20260610000000_video_
--                                pipeline_dials.sql (which seeded 'hls') and is
--                                'mp4' in this project; a fresh environment that
--                                replays migrations should set it via the dial.
--   video_pipeline_mode_mobile → mobile  (≤768px)  — default hls
--
-- Read by the client through app/services/video-pipeline.ts, which picks the
-- active key by viewport. app_settings is already in the realtime publication
-- (20260606130000_app_settings_realtime_publication.sql), so flips propagate
-- live with no deploy.
--
-- Seeding is documentation/visibility + first-paint correctness — a missing row
-- falls back to the same default (hls) in code, so this migration is safe to
-- skip-and-retry.

INSERT INTO app_settings (key, value) VALUES
  ('video_pipeline_mode_mobile', 'hls')
ON CONFLICT (key) DO NOTHING;
