-- Catalog Seeding — turn AI-stylist CHATS into demand (S6, was deferred).
--
-- Reads new style_up_traces (what each stylist worked with), pulls styling terms
-- — web stylists' clean garment queries (payload.search_queries) AND the catalog
-- stylists' last shopper message (the occasion) — and inserts the ones the
-- catalog DOESN'T already cover as pending seed_targets (kind='manual', so they
-- show in the Searches demand tab next to keyword demand). From there the existing
-- pipeline (seed-curate vets → seed-run fetches → activation publishes) fills
-- them automatically. So "stylist couldn't find it" becomes "catalog grows it".
--
-- Coverage gate: a term is MISSING only if NO active product matches ALL of its
-- content words (AND-tsquery over name + occasion text) — i.e. we have nothing
-- that genuinely fits the whole need, so we only seed real gaps and never
-- re-fetch what we already stock. NEVER overwrites status (a rejected term stays
-- rejected). Pure SQL, no spend; the fetch step is what's budgeted.
-- See docs/CATALOG_SEEDING.md (S6 / §8).

insert into public.app_settings (key, value)
values ('seeding_style_demand_watermark', (now() - interval '7 days')::text)
on conflict (key) do nothing;

create or replace function public.refresh_seed_targets_from_style_chats()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_watermark     timestamptz;
  v_new_watermark timestamptz;
  affected        integer;
begin
  select coalesce(value::timestamptz, now() - interval '7 days')
    into v_watermark
    from public.app_settings where key = 'seeding_style_demand_watermark';
  v_watermark := coalesce(v_watermark, now() - interval '7 days');

  select max(created_at) into v_new_watermark
    from public.style_up_traces where created_at > v_watermark;

  with new_traces as (
    select id, created_at, payload
    from public.style_up_traces
    where created_at > v_watermark
  ),
  terms as (
    -- web stylists: the clean per-garment queries they surfaced
    select lower(btrim(q)) as term
    from new_traces nt,
         jsonb_array_elements_text(coalesce(nt.payload->'search_queries', '[]'::jsonb)) q
    where length(btrim(q)) between 3 and 80
    union all
    -- catalog stylists: the shopper's last message (the occasion they asked for)
    select lower(btrim(x.lm)) as term
    from new_traces nt
    cross join lateral (
      select e->>'content' as lm
      from jsonb_array_elements(coalesce(nt.payload->'messages', '[]'::jsonb))
             with ordinality as a(e, ord)
      where e->>'role' = 'user'
        and length(btrim(e->>'content')) between 8 and 120
      order by ord desc
      limit 1
    ) x
    where x.lm is not null
  ),
  distinct_terms as (
    select term, count(*)::int as hits
    from terms
    where term is not null and length(term) >= 3
      -- term must yield a real tsquery after stopword stripping
      and nullif(plainto_tsquery('english', term)::text, '') is not null
    group by term
  ),
  missing as (
    select dt.term, dt.hits
    from distinct_terms dt
    where not exists (
      select 1 from public.products p
      where p.is_active
        and to_tsvector('english',
              coalesce(p.name, '') || ' ' ||
              coalesce(public.product_occasions_text(p.styling_metadata, p.fit_intelligence, p.product_taxonomy), ''))
            @@ plainto_tsquery('english', dt.term)
    )
  )
  insert into public.seed_targets (term, kind, status, search_hits, priority)
  select term, 'manual', 'pending', hits, 30 + hits
  from missing
  on conflict (lower(term), kind) do update
    set search_hits = public.seed_targets.search_hits + excluded.search_hits,
        updated_at  = now();

  get diagnostics affected = row_count;

  if v_new_watermark is not null then
    update public.app_settings
      set value = v_new_watermark::text, updated_at = now()
      where key = 'seeding_style_demand_watermark';
  end if;

  return affected;
end $$;

grant execute on function public.refresh_seed_targets_from_style_chats() to authenticated, service_role;

-- Every 30 min: pull stylist-chat demand. Pure SQL, NOT budget-gated (queue
-- building only; the fetch step is what spends). Shows in the Automation panel.
select cron.unschedule('seeding-style-demand') where exists (select 1 from cron.job where jobname = 'seeding-style-demand');
select cron.schedule('seeding-style-demand', '*/30 * * * *', 'select public.refresh_seed_targets_from_style_chats();');
