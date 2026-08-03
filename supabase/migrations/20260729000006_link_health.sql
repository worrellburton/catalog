alter table public.products
  add column if not exists url_status     smallint,
  add column if not exists url_checked_at timestamptz;

create index if not exists products_url_checked_idx
  on public.products (url_checked_at nulls first);

-- 403 == anti-bot, NOT dead. Verified in a real browser 2026-07-28: the
-- lululemon PDP that curl 403s renders fine and its price matched our stored
-- value exactly. Treating 403 as broken would condemn 58 healthy products.
create or replace function public.link_health_summary()
returns table(bucket text, n bigint) language sql stable as $$
  select case
           when url_status is null                    then 'unchecked'
           when url_status between 200 and 299        then 'live'
           when url_status = 403                      then 'bot_blocked'
           else 'dead'
         end, count(*)
    from public.products where is_active group by 1;
$$;

select cron.schedule('pipeline-link-health', '0 5 * * *', $$
  select net.http_post(
    url := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/check-product-links',
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                     where name='embed_entity_service_key' limit 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);
