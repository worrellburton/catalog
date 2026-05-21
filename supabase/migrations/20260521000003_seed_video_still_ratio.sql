-- Seed the Video → Still image ratio dial. 100 = all video (current
-- behaviour); 0 = all stills. Anything in between is a deterministic
-- per-card split. INSERT ... ON CONFLICT so reapplying the migration
-- doesn't clobber a value an admin has already moved.

INSERT INTO public.app_settings (key, value)
VALUES ('video_still_ratio', '100')
ON CONFLICT (key) DO NOTHING;
