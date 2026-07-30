-- The ingest half of the pipeline had no representation on the health page:
-- every RPC it called was creative / publish / link / spend. The funnel showed
-- scrape stages but nothing answered "is anything coming IN, and why not" -
-- which is exactly what the founder reported not being able to see.
--
-- Read-only by design. Ingest CONTROLS (brand queue, run-crawl, scrape retry)
-- are a separate slice; this makes the state observable first.
create or replace function public.pipeline_ingest_summary()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'last_product_at',      (select max(created_at) from public.products),
    'added_24h',            (select count(*) from public.products where created_at > now() - interval '24 hours'),
    'added_7d',             (select count(*) from public.products where created_at > now() - interval '7 days'),
    'added_30d',            (select count(*) from public.products where created_at > now() - interval '30 days'),
    'scrape',               (select jsonb_object_agg(coalesce(scrape_status,'(null)'), n)
                               from (select scrape_status, count(*) n from public.products group by 1) s),
    'scrape_success_rate',  (select round(100.0 * count(*) filter (where scrape_status = 'done')
                                          / nullif(count(*), 0), 1) from public.products),
    'by_source',            (select jsonb_object_agg(coalesce(source,'(manual/unknown)'), n)
                               from (select source, count(*) n from public.products group by 1
                                     order by 2 desc limit 12) s),
    'crawl_jobs',           (select jsonb_build_object(
                               'total', count(*), 'last_run', max(created_at),
                               'distinct_sites', count(distinct site_url))
                               from public.crawl_jobs),
    'discovered_urls',      (select jsonb_object_agg(status, n)
                               from (select status, count(*) n from public.crawl_discovered_urls group by 1) s),
    'seed_targets',         (select jsonb_object_agg(status, n)
                               from (select status, count(*) n from public.seed_targets group by 1) s),
    -- the ingest-side switches, so the page shows WHY nothing is arriving
    'switches',             (select jsonb_object_agg(key, value) from public.app_settings
                              where key in ('seeding_enabled','weekly_recrawl_enabled',
                                            'occasion_enrich_enabled','image_reconcile_enabled')),
    'ingest_crons',         (select jsonb_object_agg(jobname, active) from cron.job
                              where jobname like 'seeding-%' or jobname like '%crawl%'
                                 or jobname like '%scrape%' or jobname like 'occasion-%')
  );
$$;
