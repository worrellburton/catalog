-- Drop the unused `phone` column from public.waitlist.
-- We only collect email-based SSO sign-ins right now.

ALTER TABLE public.waitlist DROP COLUMN IF EXISTS phone;
