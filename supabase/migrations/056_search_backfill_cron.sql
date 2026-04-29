-- 056: Schedule nightly cold-miss backfill via pg_cron
--
-- Once a day at 00:15 UTC, fire the search-backfill edge function. It reads
-- search_query_misses, calls catalog-brainstorm to derive concrete product
-- search terms, then product-search (SerpAPI Google Shopping) to source new
-- supply, and marks each query backfill_status='queued'. The edge function
-- caps how many misses it processes per run to keep SerpAPI usage predictable.
--
-- Requires the pg_cron extension. pg_net is already enabled on this project.
-- The job uses a vault-stored service-role key so the HTTP call authenticates.

-- ── 1. Enable pg_cron ────────────────────────────────────────────────────────
create extension if not exists pg_cron with schema extensions;

-- ── 2. Store service-role key in vault (idempotent) ─────────────────────────
-- This is intentionally written as a no-op when the secret already exists so
-- the migration is safe to re-run. The actual secret value is rotated through
-- the dashboard / vault.update_secret RPC, not via SQL.
do $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'search_backfill_service_key';
  if v_id is null then
    perform vault.create_secret(
      'PLACEHOLDER_REPLACE_VIA_DASHBOARD',
      'search_backfill_service_key',
      'Service-role JWT for pg_cron-triggered search-backfill calls'
    );
  end if;
end $$;

-- ── 3. Drop existing schedule if re-running ─────────────────────────────────
do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'search_backfill_nightly';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end $$;

-- ── 4. Schedule the job ──────────────────────────────────────────────────────
-- 00:15 UTC every day. Calls search-backfill with a moderate limit.
select cron.schedule(
  'search_backfill_nightly',
  '15 0 * * *',
  $$
  select net.http_post(
    url     := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/search-backfill',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'search_backfill_service_key' limit 1)
    ),
    body    := jsonb_build_object('limit', 25)
  );
  $$
);

comment on extension pg_cron is
  'Used by 056_search_backfill_cron — nightly search-miss backfill job (search_backfill_nightly).';
