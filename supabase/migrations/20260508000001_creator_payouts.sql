-- ─────────────────────────────────────────────────────────────────────────────
-- Creator Payouts with Dots Integration
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Payout fields on profiles ─────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS dots_user_id         text,
  ADD COLUMN IF NOT EXISTS is_payout_verified   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_payout_active     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payout_withdraw_link text;

-- ── 2. Wallet entries — running ledger ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wallet_entries (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount          numeric(10,2) NOT NULL DEFAULT 0,
  type            text        NOT NULL CHECK (type IN ('credit','debit','on_hold')),
  current_balance numeric(10,2) NOT NULL DEFAULT 0,
  total_earning   numeric(10,2) NOT NULL DEFAULT 0,
  total_withdraw  numeric(10,2) NOT NULL DEFAULT 0,
  comment         text,
  entry_code      text,   -- DISCOVER | REWARD | WITHDRAW | CATALOG_ORDER | etc.
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wallet_entries_user_id_idx ON public.wallet_entries (user_id);
CREATE INDEX IF NOT EXISTS wallet_entries_created_at_idx ON public.wallet_entries (created_at DESC);

ALTER TABLE public.wallet_entries ENABLE ROW LEVEL SECURITY;

-- Creators can read their own entries; admins can read all
CREATE POLICY "wallet_read_own" ON public.wallet_entries
  FOR SELECT USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true
    )
  );

-- Only service role may insert / update (via edge function)
CREATE POLICY "wallet_service_role_write" ON public.wallet_entries
  FOR ALL USING (auth.role() = 'service_role');

-- ── 3. Payout transfers — Dots transfer log ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payout_transfers (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  dots_transfer_id text,
  dots_user_id     text,
  amount           numeric(10,2) NOT NULL,
  status           text        NOT NULL DEFAULT 'pending',
  raw_response     jsonb,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payout_transfers_user_id_idx ON public.payout_transfers (user_id);

ALTER TABLE public.payout_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transfers_read_own_or_admin" ON public.payout_transfers
  FOR SELECT USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true
    )
  );

CREATE POLICY "transfers_service_role_write" ON public.payout_transfers
  FOR ALL USING (auth.role() = 'service_role');

-- ── 4. Payout settings — admin-configurable rates ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.payout_settings (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_value numeric(10,2) NOT NULL DEFAULT 5.00,  -- pool distributed per period
  cac          numeric(10,2) NOT NULL DEFAULT 2.00,  -- customer acquisition cost reward
  frequency    text        NOT NULL DEFAULT 'weekly'
                             CHECK (frequency IN ('daily','weekly','biweekly','monthly')),
  effective_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE public.payout_settings ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read settings (creator needs CAC value)
CREATE POLICY "settings_read_auth" ON public.payout_settings
  FOR SELECT USING (auth.role() IN ('authenticated','service_role'));

CREATE POLICY "settings_service_role_write" ON public.payout_settings
  FOR ALL USING (auth.role() = 'service_role');

-- Seed a default settings row
INSERT INTO public.payout_settings (payout_value, cac, frequency)
VALUES (5.00, 2.00, 'weekly')
ON CONFLICT DO NOTHING;
