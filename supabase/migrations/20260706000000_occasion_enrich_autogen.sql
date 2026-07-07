-- Occasion enrichment auto-gen — DECOUPLED from the seeding kill-switch.
--
-- styling_metadata.occasion powers two live surfaces: the AI stylist retrieval
-- (style_slot_search / retrieveOccasionCandidates) AND the consumer search BM25
-- lane (product_occasions_text -> search_products, weight A). Yet the only thing
-- that ever produced it was run_seeding_occasion_backfill(), which is gated
-- behind seeding_enabled='false' AND whose cron sits inactive — so ~34% of
-- active products (147/434) carried no occasion and were dark to both surfaces.
--
-- Fix: occasion enrichment is cheap (Haiku) and self-limiting (only touches rows
-- missing occasion), so it should NOT ride the expensive-SerpAPI seeding switch.
-- This gives it its own always-on cron + its own kill-switch (fail-OPEN, default
-- on), so any NEW product gets occasion within ~15 min regardless of whether the
-- seeding engine is running.

-- own kill-switch, default ON (operator flips to 'false' to pause)
insert into public.app_settings (key, value)
values ('occasion_enrich_enabled', 'true')
on conflict (key) do nothing;

create or replace function public.run_occasion_enrich_backfill()
returns void language plpgsql security definer set search_path = public as $$
declare v_token text; enabled text;
begin
  select value into enabled from public.app_settings where key = 'occasion_enrich_enabled';
  -- fail-OPEN: absent flag => enrich. Only an explicit 'false' pauses it.
  if coalesce(enabled, 'true') = 'false' then return; end if;
  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'search_backfill_service_key' limit 1;
  perform net.http_post(
    url     := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/enrich-occasions',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||coalesce(v_token,'')),
    body    := jsonb_build_object('backfill', 25)
  );
end $$;
revoke all on function public.run_occasion_enrich_backfill() from public;
grant execute on function public.run_occasion_enrich_backfill() to service_role;

-- schedule every 15 min (idempotent: drop-if-exists then create)
select cron.unschedule('occasion-enrich') where exists (select 1 from cron.job where jobname = 'occasion-enrich');
select cron.schedule('occasion-enrich', '*/15 * * * *', 'select public.run_occasion_enrich_backfill();');
