-- Signup waitlist: every new user is placed here; admin approves
-- to promote them into the main app.

CREATE SEQUENCE IF NOT EXISTS public.waitlist_position_seq START 1;

CREATE TABLE IF NOT EXISTS public.waitlist (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT nextval('public.waitlist_position_seq') UNIQUE,
  email text,
  full_name text,
  avatar_url text,
  provider text,
  approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz
);

ALTER SEQUENCE public.waitlist_position_seq OWNED BY public.waitlist.position;

CREATE INDEX IF NOT EXISTS waitlist_approved_idx ON public.waitlist (approved);
CREATE INDEX IF NOT EXISTS waitlist_created_at_idx ON public.waitlist (created_at DESC);

ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "waitlist_select_own" ON public.waitlist;
CREATE POLICY "waitlist_select_own" ON public.waitlist
  FOR SELECT TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS "waitlist_insert_own" ON public.waitlist;
CREATE POLICY "waitlist_insert_own" ON public.waitlist
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "waitlist_admin_all" ON public.waitlist;
CREATE POLICY "waitlist_admin_all" ON public.waitlist
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Total waitlist count without exposing row-level data.
CREATE OR REPLACE FUNCTION public.get_waitlist_total()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer FROM public.waitlist;
$$;

GRANT EXECUTE ON FUNCTION public.get_waitlist_total() TO authenticated, anon;

-- Approve a waitlist entry (admin only, enforced via RLS on the UPDATE).
CREATE OR REPLACE FUNCTION public.approve_waitlist_entry(entry_id uuid)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.waitlist
     SET approved = true, approved_at = now()
   WHERE id = entry_id;
$$;

GRANT EXECUTE ON FUNCTION public.approve_waitlist_entry(uuid) TO authenticated;

-- Grandfather existing users: anyone already in public.profiles gets an
-- auto-approved waitlist row so they don't hit the gate on next sign-in.
INSERT INTO public.waitlist (id, email, full_name, avatar_url, provider, approved, approved_at)
SELECT id, email, full_name, avatar_url, provider, true, now()
FROM public.profiles
ON CONFLICT (id) DO NOTHING;

