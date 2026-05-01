-- Platform-wide key/value settings table.
-- Used by admin panel to configure generation model, feature flags, etc.
CREATE TABLE IF NOT EXISTS app_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- Seed the default look video model (Vidu — no ByteDance filter).
INSERT INTO app_settings (key, value)
VALUES ('look_video_model', 'fal-ai/vidu/reference-to-video')
ON CONFLICT (key) DO NOTHING;

-- Only service-role can write; anon can read so edge functions using the
-- anon key can still read settings without issue.
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON app_settings
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "anon_read" ON app_settings
  FOR SELECT USING (true);
