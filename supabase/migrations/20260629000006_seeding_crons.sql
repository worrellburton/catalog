-- Catalog Seeding — schedule the loop. ALL spend/feed-changing steps no-op
-- while app_settings.seeding_enabled='false' (the fail-closed kill-switch), so
-- scheduling them is inert until an operator flips the switch. Mirrors the
-- vault-token net.http_post pattern of run_haiku_context_backfill. See
-- docs/CATALOG_SEEDING.md.

-- ── refresh the demand queue from search_logs (cheap, SQL-only, not gated) ──
create or replace function public.run_seeding_refresh()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_seed_targets_from_searches();
end $$;
revoke all on function public.run_seeding_refresh() from public;
grant execute on function public.run_seeding_refresh() to service_role;

-- ── occasion enrichment for products missing it (gated) ─────────────────────
create or replace function public.run_seeding_occasion_backfill()
returns void language plpgsql security definer as $$
declare v_token text; enabled text;
begin
  select value into enabled from public.app_settings where key = 'seeding_enabled';
  if coalesce(enabled, 'false') <> 'true' then return; end if;
  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'search_backfill_service_key' limit 1;
  perform net.http_post(
    url     := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/enrich-occasions',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||coalesce(v_token,'')),
    body    := jsonb_build_object('backfill', 20)
  );
end $$;
revoke all on function public.run_seeding_occasion_backfill() from public;
grant execute on function public.run_seeding_occasion_backfill() to service_role;

-- ── the seeding driver: fetch products for due targets (gated, spends $$) ────
create or replace function public.run_seeding_driver()
returns void language plpgsql security definer as $$
declare v_token text; enabled text;
begin
  select value into enabled from public.app_settings where key = 'seeding_enabled';
  if coalesce(enabled, 'false') <> 'true' then return; end if;
  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'search_backfill_service_key' limit 1;
  perform net.http_post(
    url     := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/seed-run',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||coalesce(v_token,'')),
    body    := '{}'::jsonb
  );
end $$;
revoke all on function public.run_seeding_driver() from public;
grant execute on function public.run_seeding_driver() to service_role;

-- ── schedules (unschedule-if-exists then schedule) ──────────────────────────
select cron.unschedule('seeding-refresh')  where exists (select 1 from cron.job where jobname = 'seeding-refresh');
select cron.unschedule('seeding-occasion') where exists (select 1 from cron.job where jobname = 'seeding-occasion');
select cron.unschedule('seeding-driver')   where exists (select 1 from cron.job where jobname = 'seeding-driver');
select cron.unschedule('seeding-activate') where exists (select 1 from cron.job where jobname = 'seeding-activate');
select cron.unschedule('seeding-budget-reset') where exists (select 1 from cron.job where jobname = 'seeding-budget-reset');

select cron.schedule('seeding-refresh',  '0 * * * *',   'select public.run_seeding_refresh();');
select cron.schedule('seeding-occasion', '*/15 * * * *','select public.run_seeding_occasion_backfill();');
select cron.schedule('seeding-driver',   '*/30 * * * *','select public.run_seeding_driver();');
select cron.schedule('seeding-activate', '*/15 * * * *','select public.run_seeding_activation();');
select cron.schedule('seeding-budget-reset', '0 0 1 * *',
  $$update public.app_settings set value = '0' where key = 'seeding_serpapi_used_month';$$);
