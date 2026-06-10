-- Track which admin (if any) kicked off a generation. Null for the
-- normal shopper flow where the row's user_id IS the human triggering
-- it; set to auth.users(id) when /generate?as_user=<id> impersonation
-- attaches the row to an AI persona instead. Lets the admin user
-- detail page split "Triggered by admin" from "User-triggered" in the
-- queue view.

ALTER TABLE public.user_generations
  ADD COLUMN IF NOT EXISTS triggered_by_admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS user_generations_triggered_by_admin_idx
  ON public.user_generations (triggered_by_admin_id, created_at DESC)
  WHERE triggered_by_admin_id IS NOT NULL;

COMMENT ON COLUMN public.user_generations.triggered_by_admin_id IS
  'Admin auth.users.id that submitted this generation via /generate?as_user=. Null for self-triggered shopper flows. The row''s user_id always remains the persona/shopper the look is FOR.';
