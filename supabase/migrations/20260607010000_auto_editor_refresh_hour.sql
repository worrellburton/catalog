-- Automatic Editor: daily-feed refresh hour (UTC).
-- 0 = midnight-UTC rollover (the prior, unconfigurable default). Read via
-- services/dials.ts; the personalize-feed edge function uses it to compute the
-- per-user feed-day boundary so admins can choose when the daily feed rolls over.
insert into public.app_settings (key, value) values
  ('auto_editor_refresh_hour', '0')
on conflict (key) do nothing;
