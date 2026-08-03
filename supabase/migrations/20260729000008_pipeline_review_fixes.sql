-- Fixes from the whole-branch review (2026-07-28). Every finding below was
-- verified against live data before the fix was written.
--
-- C2 (CRITICAL, was live-exploitable): the driver functions are SECURITY
-- DEFINER and Postgres grants EXECUTE to PUBLIC by default, so PostgREST
-- exposed them as UNAUTHENTICATED endpoints. reap_stuck_generation_jobs takes
-- a caller-supplied interval, so anon could POST p_older_than='-1 second' and
-- fail every in-flight generation job at will.
revoke execute on function public.run_pipeline_creative_drain(boolean) from public, anon, authenticated;
revoke execute on function public.run_pipeline_publish(boolean)        from public, anon, authenticated;
revoke execute on function public.reap_stuck_generation_jobs(interval) from public, anon, authenticated;
revoke execute on function public.fal_month_spend()                    from public, anon, authenticated;
grant execute on function public.run_pipeline_creative_drain(boolean) to service_role;
grant execute on function public.run_pipeline_publish(boolean)        to service_role;
grant execute on function public.reap_stuck_generation_jobs(interval) to service_role;
grant execute on function public.fal_month_spend()                    to service_role;

-- C3: creative spend is NOT all fal. product_creative.model defaults to
-- 'veo-3.1-fast-generate-preview', which routes to Google Veo, so a
-- platform='fal' sum silently misses it. Meter by OPERATION instead.
create or replace function public.creative_month_spend()
returns numeric language sql stable as $$
  select coalesce(sum(estimated_cost_usd), 0)
    from public.ai_usage_logs
   where operation = 'product-creative'
     and created_at >= date_trunc('month', now());
$$;
revoke execute on function public.creative_month_spend() from public, anon, authenticated;
grant  execute on function public.creative_month_spend() to service_role;

create or replace function public.run_pipeline_creative_drain(p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_enabled boolean := coalesce((select value from app_settings where key='pipeline_enabled'), 'false') = 'true';
  v_cr_on   boolean := coalesce((select value from app_settings where key='pipeline_creative_enabled'), 'false') = 'true';
  v_per_day int     := coalesce((select value from app_settings where key='pipeline_creatives_per_day'), '0')::int;
  v_cap     numeric := coalesce((select value from app_settings where key='pipeline_creative_monthly_usd_cap'), '0')::numeric;
  v_spend   numeric := public.creative_month_spend();
  v_today   int;
  v_n       int;
  v_ids     uuid[];
begin
  if not v_enabled then return jsonb_build_object('skipped','pipeline_disabled'); end if;
  if not v_cr_on   then return jsonb_build_object('skipped','creative_disabled'); end if;

  if v_spend >= v_cap then
    insert into pipeline_events(stage, event, detail)
    values ('creative','budget', jsonb_build_object('spend',v_spend,'cap',v_cap));
    return jsonb_build_object('skipped','budget_cap','spend',v_spend,'cap',v_cap);
  end if;

  select count(*) into v_today from product_creative
   where created_at >= date_trunc('day', now());
  v_n := least(v_per_day - v_today, 25);
  if v_n <= 0 then return jsonb_build_object('skipped','daily_limit','today',v_today); end if;

  select array_agg(id) into v_ids from (
    select p.id
      from products p
     where public.pipeline_stage(p.*) in ('published_no_creative','awaiting_creative')
       -- I1: 'published_no_creative' is arm 2 and short-circuits every quality
       -- arm, so an active-but-unverified product would get a PAID render and
       -- stay invisible afterwards. 10 such rows measured live (247 -> 237).
       and p.image_verified is not false
       and coalesce(p.styling_metadata->>'occasion','') <> ''
       -- I8: never re-queue a product whose render already failed; ordered by
       -- created_at it would sit at the head of the queue and eat the daily
       -- quota forever. (generation_jobs is 250 failed / 444 done - failures
       -- are not hypothetical.)
       and not exists (
         select 1 from product_creative c
          where c.product_id = p.id and c.status = 'failed'
       )
     order by (public.pipeline_stage(p.*) = 'published_no_creative') desc, p.created_at
     limit v_n
  ) s;

  if v_ids is null then return jsonb_build_object('queued',0,'reason','nothing_eligible'); end if;
  if p_dry_run then
    return jsonb_build_object('dry_run',true,'would_queue',array_length(v_ids,1),'ids',v_ids);
  end if;

  -- C1 (CRITICAL): product_creative.enabled DEFAULTS TO FALSE and
  -- promote_creative_to_primary_video() requires enabled=true. Without this
  -- the render happens and is billed, but products.primary_video_url stays
  -- NULL - so the product remains 'published_no_creative', is re-selected on
  -- the next tick, and the backlog never shrinks while spend climbs forever.
  -- 29 rows in exactly this shape already exist in product_creative.
  insert into product_creative (product_id, status, enabled)
  select unnest(v_ids), 'pending', true;

  insert into pipeline_events (product_id, stage, event)
  select unnest(v_ids), 'creative', 'queued';

  return jsonb_build_object('queued',array_length(v_ids,1),'spend',v_spend,'cap',v_cap);
end $$;
revoke execute on function public.run_pipeline_creative_drain(boolean) from public, anon, authenticated;
grant  execute on function public.run_pipeline_creative_drain(boolean) to service_role;

-- I7: master ON must not silently ARM crons deliberately created inactive,
-- and master OFF (the kill switch) must not stop the harmless watchdogs you
-- most want running during an incident.
create or replace function public.set_pipeline_master(p_on boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
declare r record;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;
  update public.app_settings
     set value = case when p_on then 'true' else 'false' end, updated_at = now()
   where key = 'pipeline_enabled';
  if not p_on then
    for r in select jobid from cron.job
              where jobname in ('pipeline-creative-drain','pipeline-publish') loop
      perform cron.alter_job(job_id := r.jobid, active := false);
    end loop;
  end if;
end $$;
