-- Lock down quickbooks_tokens: OAuth secrets must never be reachable via anon/authenticated.
-- Service-role bypasses RLS, so server/edge access continues to work.
alter table public.quickbooks_tokens enable row level security;
revoke all on public.quickbooks_tokens from anon, authenticated;
