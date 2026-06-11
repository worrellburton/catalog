-- Kaizen — the morning continuous-improvement sweep.
--
-- kaizen_runs records each pass of the `kaizen` edge function (the
-- server twin of the type brain's Kaizen panel): what it found across
-- the whole catalog and how many safe sync fixes it auto-applied.
-- Scheduled daily at 10:00 UTC (≈ 6 a.m. ET, same slot as
-- generate-type-icons) via the vault-token net.http_post pattern.

create table if not exists public.kaizen_runs (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  source text not null default 'cron',
  finding_count int not null default 0,
  auto_fixed int not null default 0,
  report jsonb
);

alter table public.kaizen_runs enable row level security;

drop policy if exists "kaizen runs admin read" on public.kaizen_runs;
create policy "kaizen runs admin read" on public.kaizen_runs
  for select to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin));

-- ── Invoker ─────────────────────────────────────────────────────────────────

create or replace function public.run_kaizen()
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
    url     := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/kaizen',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || coalesce(v_token, '')
    ),
    body    := jsonb_build_object('source', 'cron')
  );
end;
$function$;

revoke all on function public.run_kaizen() from public;
grant execute on function public.run_kaizen() to service_role;

-- ── pg_cron schedule (idempotent) ───────────────────────────────────────────

select cron.unschedule('kaizen-daily')
where exists (select 1 from cron.job where jobname = 'kaizen-daily');

select cron.schedule('kaizen-daily', '0 10 * * *', 'select public.run_kaizen();');
