-- 20260618000000_haiku_context_backfill_cron.sql
--
-- Keep products.haiku_context from stalling on "pending". The haiku-context
-- edge function fills it per-product when a primary image is picked (the
-- products_haiku_context trigger), plus a one-shot {backfill: N}. New scrapes
-- pile up faster than a single backfill drains, so this adds a RECURRING
-- backfill that keeps processing products which have an image but no context
-- yet. It "never ends" — it just idles (the function no-ops) once the queue is
-- empty, then picks up again as new products land.
--
-- Same vault-token net.http_post pattern as run_kaizen / generate-type-icons
-- (daily kaizen sweep). Batch + cadence are tunable below.

create or replace function public.run_haiku_context_backfill()
returns void
language plpgsql
security definer
as $function$
declare
  v_token text;
begin
  select decrypted_secret into v_token
    from vault.decrypted_secrets
   where name = 'search_backfill_service_key'
   limit 1;

  perform net.http_post(
    url     := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/haiku-context',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || coalesce(v_token, '')
    ),
    body    := jsonb_build_object('backfill', 20)
  );
end;
$function$;

revoke all on function public.run_haiku_context_backfill() from public;
grant execute on function public.run_haiku_context_backfill() to service_role;

-- Every 10 minutes: drains the pending queue continuously (≈120 products/hr),
-- idles when empty. Drop the cadence (e.g. '*/5') or raise the batch if the
-- backlog needs to clear faster and the Haiku-vision spend allows.
select cron.unschedule('haiku-context-backfill')
where exists (select 1 from cron.job where jobname = 'haiku-context-backfill');

select cron.schedule('haiku-context-backfill', '*/10 * * * *', 'select public.run_haiku_context_backfill();');
