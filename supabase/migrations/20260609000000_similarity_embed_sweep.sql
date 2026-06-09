-- 20260609000000_similarity_embed_sweep
--
-- Self-heal for the "Similar" rail. The auto path (trg_products_auto_enrich_
-- similarity → enrich-similarity) writes products.similarity_profile FIRST and
-- then fires embed-product (target=similarity) as a swallowed fire-and-forget
-- call. When that second step fails, the row is left with a profile but no
-- similarity_embedding — and nothing ever retries it:
--   • the trigger short-circuits on `similarity_profile is not null`, so it
--     never re-fires for a half-finished row, and
--   • there was no daily catch-up sweep.
--
-- Result: such rows fall out of the Similar index permanently (observed: 62
-- products stuck, incl. most of the easyplant catalogue → "Similar" showing 2).
--
-- This migration adds the missing catch-up: a sweep that re-embeds any row with
-- a profile but no embedding, scheduled daily, plus a one-shot run to clear the
-- current backlog. embed-product is idempotent and runs gte-small in-edge (no
-- Claude / external API cost), so re-firing stuck rows is cheap and safe.

-- ── Sweep procedure ─────────────────────────────────────────────────────────
-- Fires embed-product (target=similarity) for each product that has a
-- similarity_profile but no similarity_embedding. Reuses the same vault service
-- key as the auto-embed trigger. Fire-and-forget via pg_net; embed-product
-- writes similarity_embedding + similarity_embedded_at on success and is a
-- no-op once embedded, so the next sweep naturally stops touching it.

create or replace function public.similarity_embed_sweep(batch_limit int default 200)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_count int := 0;
  r record;
begin
  select decrypted_secret into v_token
    from vault.decrypted_secrets
   where name = 'embed_entity_service_key'
   limit 1;
  if v_token is null or v_token = 'PLACEHOLDER_REPLACE_VIA_DASHBOARD' then
    raise notice 'similarity_embed_sweep: embed_entity_service_key missing/placeholder, skipping';
    return 0;
  end if;

  for r in
    select id
    from public.products
    where similarity_profile is not null
      and similarity_profile <> ''
      and similarity_embedding is null
      and name is not null
      and name <> ''
    order by created_at
    limit batch_limit
  loop
    perform net.http_post(
      url     := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/embed-product',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_token
      ),
      body    := jsonb_build_object('id', r.id, 'target', 'similarity')
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Service-role can run the sweep; everyone else cannot.
revoke all on function public.similarity_embed_sweep(int) from public;
grant execute on function public.similarity_embed_sweep(int) to service_role;

-- ── pg_cron schedule ────────────────────────────────────────────────────────
-- Daily at 03:00 UTC (away from the 06:00 gender backfill and 07:17 catalog
-- refresh). Idempotent — drop a stale job with the same name first so this
-- migration can be re-applied without duplicating.

do $$
begin
  perform cron.unschedule('similarity_embed_sweep_daily')
  where exists (
    select 1 from cron.job where jobname = 'similarity_embed_sweep_daily'
  );
exception when others then
  -- cron.unschedule errors when no job exists; ignore.
  null;
end;
$$;

select cron.schedule(
  'similarity_embed_sweep_daily',
  '0 3 * * *',
  $$select public.similarity_embed_sweep();$$
);

-- One-shot: clear the current backlog now rather than waiting until 03:00 UTC.
select public.similarity_embed_sweep();
