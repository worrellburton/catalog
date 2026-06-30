-- Style Scenarios — weekly Claude generator cron. Tops up the Styling tab with
-- fresh styling scenarios (occasion × gender × season) via the
-- generate-style-scenarios edge fn. NOT budget-gated: generation is Claude-only
-- (no SerpAPI spend), and the scenarios land 'paused' (simulation cases, not
-- demand). Named seeding-* so it shows in the /admin/seeding Automation panel
-- and is pausable via set_seeding_cron_active. See docs/CATALOG_SEEDING.md.

create or replace function public.run_style_scenario_generate()
returns void language plpgsql security definer as $$
declare v_token text;
begin
  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'search_backfill_service_key' limit 1;
  perform net.http_post(
    url     := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/generate-style-scenarios',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||coalesce(v_token,'')),
    body    := jsonb_build_object('count', 10)
  );
end $$;
revoke all on function public.run_style_scenario_generate() from public;
grant execute on function public.run_style_scenario_generate() to service_role;

select cron.unschedule('seeding-style-generate') where exists (select 1 from cron.job where jobname = 'seeding-style-generate');
-- weekly, Monday 05:30 UTC; dedups against existing scenarios so it only adds new ones
select cron.schedule('seeding-style-generate', '30 5 * * 1', 'select public.run_style_scenario_generate();');
