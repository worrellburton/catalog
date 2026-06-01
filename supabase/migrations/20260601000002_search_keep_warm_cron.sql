-- Keep the `search` edge function warm.
--
-- The gte-small model is loaded lazily into the edge isolate on first use, so a
-- cold isolate pays ~1.2s on the first query vs ~370ms warm. A 1-minute pg_cron
-- ping ({"warmup":true}) keeps the isolate + model resident so real user queries
-- stay fast. Mirrors the existing net.http_post pattern used by notify_* fns.

create or replace function public.warm_search()
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

  -- search has verify_jwt=false, so the call works even if the secret is unset;
  -- include the bearer when present for forward-compat.
  perform net.http_post(
    url     := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/search',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || coalesce(v_token, '')
    ),
    body    := jsonb_build_object('warmup', true)
  );
end;
$function$;

-- Schedule every minute (idempotent: unschedule a prior job of the same name).
select cron.unschedule('search-keep-warm')
where exists (select 1 from cron.job where jobname = 'search-keep-warm');

select cron.schedule('search-keep-warm', '* * * * *', 'select public.warm_search();');
