-- Haiku context — Claude Haiku's read of each product's primary image
-- ("what this item ACTUALLY is"), used by type governance to out-vote
-- misleading names. Regenerated whenever a primary image is picked.

alter table public.products add column if not exists haiku_context text;
alter table public.products add column if not exists haiku_context_at timestamptz;

create or replace function public.trg_haiku_context()
returns trigger language plpgsql security definer as $function$
declare v_token text;
begin
  if new.primary_image_url is null then return new; end if;
  if tg_op = 'UPDATE' and new.primary_image_url is not distinct from old.primary_image_url then
    return new;
  end if;
  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'search_backfill_service_key' limit 1;
  perform net.http_post(
    url     := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/haiku-context',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||coalesce(v_token,'')),
    body    := jsonb_build_object('productId', new.id),
    timeout_milliseconds := 60000);
  return new;
end;
$function$;

drop trigger if exists products_haiku_context on public.products;
create trigger products_haiku_context
  after insert or update of primary_image_url on public.products
  for each row execute function public.trg_haiku_context();

-- Self-terminating backfill: every 2 minutes describe up to 25 products
-- missing context; unschedules itself when none remain.
create or replace function public.run_haiku_backfill()
returns void language plpgsql security definer as $function$
declare v_token text; v_remaining int;
begin
  select count(*) into v_remaining from public.products
   where haiku_context is null and primary_image_url is not null and is_active;
  if v_remaining = 0 then
    perform cron.unschedule('haiku-backfill')
    where exists (select 1 from cron.job where jobname = 'haiku-backfill');
    return;
  end if;
  select decrypted_secret into v_token from vault.decrypted_secrets
   where name = 'search_backfill_service_key' limit 1;
  perform net.http_post(
    url := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/haiku-context',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||coalesce(v_token,'')),
    body := jsonb_build_object('backfill', 25),
    timeout_milliseconds := 150000);
end;
$function$;
revoke all on function public.run_haiku_backfill() from public;
grant execute on function public.run_haiku_backfill() to service_role;
select cron.unschedule('haiku-backfill') where exists (select 1 from cron.job where jobname = 'haiku-backfill');
select cron.schedule('haiku-backfill', '*/2 * * * *', 'select public.run_haiku_backfill();');
