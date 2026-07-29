-- Two permission bugs found only by loading the page as a real signed-in
-- admin. Testing the SQL as `postgres` could never have caught them: that role
-- already holds every grant involved.
--
-- 1. pipeline_ingest_summary() reads cron.job, and `authenticated` has no
--    USAGE on the cron schema -> "permission denied for schema cron". It also
--    exposes app_settings and crawl state, so it becomes SECURITY DEFINER
--    *with* an is_admin check rather than simply being granted wider access.
-- 2. pipeline_cost_per_published() calls creative_month_spend(), whose EXECUTE
--    was revoked from authenticated as a driver-internal function - so the
--    caller-rights wrapper failed for admins too.
--
-- (Bodies identical to 20260729000012 / 20260729000008 apart from the
--  security context and the guard; see those files for the query rationale.)
create or replace function public.pipeline_ingest_summary()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object(
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
    'switches',             (select jsonb_object_agg(key, value) from public.app_settings
                              where key in ('seeding_enabled','weekly_recrawl_enabled',
                                            'occasion_enrich_enabled','image_reconcile_enabled')),
    'ingest_crons',         (select jsonb_object_agg(jobname, active) from cron.job
                              where jobname like 'seeding-%' or jobname like '%crawl%'
                                 or jobname like '%scrape%' or jobname like 'occasion-%')
  );
end $$;

create or replace function public.pipeline_cost_per_published()
returns numeric language plpgsql stable security definer set search_path to 'public' as $$
declare v numeric;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;
  select case when n = 0 then 0
              else round((public.creative_month_spend() / n)::numeric, 4) end into v
    from (select count(*)::numeric as n from public.pipeline_events
           where stage = 'publish' and event = 'published'
             and created_at >= date_trunc('month', now())) s;
  return v;
end $$;
