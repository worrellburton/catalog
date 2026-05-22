-- Flag a profile as an AI persona. Admins create AI users to own
-- generated looks without a real auth identity behind them. Default
-- false so every existing row stays a real user.
--
-- Indexed on (is_ai, last_sign_in_at desc) so the admin AI Users
-- listing reads the same way the regular Users listing does.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_ai boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_profiles_is_ai
  ON public.profiles (is_ai, last_sign_in_at DESC NULLS LAST)
  WHERE is_ai = true;

COMMENT ON COLUMN public.profiles.is_ai IS
  'When true, the profile represents an AI persona created by an admin (not a real shopper / creator). AI personas can own generated looks, have reference photos, and carry the same height / age / gender fields as a real user.';
