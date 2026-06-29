-- Catalog Seeding — auto-curate cron. Runs Claude over PENDING terms to approve
-- real searches and reject gibberish. NOT gated by seeding_enabled (curation is
-- cheap Claude-only, no SerpAPI spend, and prepping the queue before turning the
-- loop on is useful). Pause it from the /admin/seeding Automation panel if
-- unwanted. See docs/CATALOG_SEEDING.md.

create or replace function public.run_seeding_curate()
returns void language plpgsql security definer as $$
declare v_token text;
begin
  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'search_backfill_service_key' limit 1;
  perform net.http_post(
    url     := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/seed-curate',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||coalesce(v_token,'')),
    body    := jsonb_build_object('limit', 50)
  );
end $$;
revoke all on function public.run_seeding_curate() from public;
grant execute on function public.run_seeding_curate() to service_role;

select cron.unschedule('seeding-curate') where exists (select 1 from cron.job where jobname = 'seeding-curate');
-- every 10 min; idles cheaply (no Claude call) once the pending queue is empty
select cron.schedule('seeding-curate', '*/10 * * * *', 'select public.run_seeding_curate();');
