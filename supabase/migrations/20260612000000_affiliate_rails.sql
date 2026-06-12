-- Affiliate monetization rails (Shopnomix).
--
-- affiliate_clicks: one row per outbound clickout, written client-side at
-- the moment of the click. The row id IS the `cid` embedded in the
-- Shopnomix redirect, so the reporting API's conversions join back to:
-- WHO clicked, WHAT product, and — the founder's revenue-share core —
-- WHICH CREATOR's surface earned it (look, creator catalog/profile).
--
-- affiliate_conversions: commissions pulled from the Shopnomix reporting
-- API by the affiliate-sync edge function (daily cron, 11:00 UTC).
-- creator_handle + creator_share are denormalized from the click row at
-- sync time using the affiliate_creator_share_pct dial.

create table if not exists public.affiliate_clicks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  product_id uuid,
  product_url text not null,
  brand text,
  creator_handle text,
  look_id text,
  surface text not null default 'feed',
  campaign_id text not null,
  wrapped boolean not null default true,
  clicked_at timestamptz not null default now()
);
create index if not exists affiliate_clicks_creator_idx on public.affiliate_clicks (creator_handle, clicked_at desc);
create index if not exists affiliate_clicks_clicked_idx on public.affiliate_clicks (clicked_at desc);

alter table public.affiliate_clicks enable row level security;

-- Guests click too — inserts are open (write-only telemetry, like events);
-- reads are admin-only.
drop policy if exists "affiliate clicks insert" on public.affiliate_clicks;
create policy "affiliate clicks insert" on public.affiliate_clicks
  for insert to anon, authenticated with check (true);
drop policy if exists "affiliate clicks admin read" on public.affiliate_clicks;
create policy "affiliate clicks admin read" on public.affiliate_clicks
  for select to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin));

create table if not exists public.affiliate_conversions (
  commission_id text primary key,
  click_id uuid references public.affiliate_clicks(id),
  campaign_id text,
  click_time timestamptz,
  revenue numeric not null default 0,
  status text,
  root_domain text,
  country text,
  source text,
  creator_handle text,
  creator_share numeric not null default 0,
  raw jsonb,
  synced_at timestamptz not null default now()
);
create index if not exists affiliate_conversions_creator_idx on public.affiliate_conversions (creator_handle, click_time desc);

alter table public.affiliate_conversions enable row level security;
drop policy if exists "affiliate conversions admin read" on public.affiliate_conversions;
create policy "affiliate conversions admin read" on public.affiliate_conversions
  for select to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin));

-- Dials: kill switch + the creator's cut of net commission (percent).
insert into public.app_settings (key, value) values
  ('affiliate_enabled', 'true'),
  ('affiliate_creator_share_pct', '50')
on conflict (key) do nothing;

-- Reporting keys live in Vault (created out-of-band, never in the repo):
--   shopnomix_reporting_key_content / _answer / _client
-- This service-only accessor hands them to the affiliate-sync function.
create or replace function public.get_affiliate_secrets()
returns table(name text, secret text)
language sql
security definer
as $$
  select s.name::text, s.decrypted_secret::text
  from vault.decrypted_secrets s
  where s.name in ('shopnomix_reporting_key_content', 'shopnomix_reporting_key_answer', 'shopnomix_reporting_key_client');
$$;
revoke all on function public.get_affiliate_secrets() from public;
grant execute on function public.get_affiliate_secrets() to service_role;

-- ── Daily conversion sync (same vault-token http_post pattern as kaizen) ──
create or replace function public.run_affiliate_sync()
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
    url     := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/affiliate-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || coalesce(v_token, '')
    ),
    body    := jsonb_build_object('source', 'cron'),
    timeout_milliseconds := 120000
  );
end;
$function$;
revoke all on function public.run_affiliate_sync() from public;
grant execute on function public.run_affiliate_sync() to service_role;

select cron.unschedule('affiliate-sync-daily')
where exists (select 1 from cron.job where jobname = 'affiliate-sync-daily');
select cron.schedule('affiliate-sync-daily', '0 11 * * *', 'select public.run_affiliate_sync();');

-- (Appended same-day) Haiku context: see haiku_context migration applied
-- separately — products.haiku_context/_at + products_haiku_context trigger
-- + self-terminating haiku-backfill cron live in the database; the repo
-- copy of those statements is in 20260612010000_haiku_context.sql.
