-- Creative generation driver. A CRON, not a row trigger: a BEFORE INSERT
-- trigger cannot express "40 per day" or "stop at $50 this month".
--
-- DO NOT enable until agents/video-generator reports real fal cost into
-- ai_usage_logs. Before that, fal_month_spend() is always 0 and the cap below
-- can never trip.
create or replace function public.fal_month_spend()
returns numeric language sql stable as $$
  select coalesce(sum(estimated_cost_usd), 0)
    from public.ai_usage_logs
   where platform = 'fal'
     and created_at >= date_trunc('month', now());
$$;

create or replace function public.run_pipeline_creative_drain(p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_enabled boolean := coalesce((select value from app_settings where key='pipeline_enabled'), 'false') = 'true';
  v_cr_on   boolean := coalesce((select value from app_settings where key='pipeline_creative_enabled'), 'false') = 'true';
  v_per_day int     := coalesce((select value from app_settings where key='pipeline_creatives_per_day'), '0')::int;
  v_cap     numeric := coalesce((select value from app_settings where key='pipeline_creative_monthly_usd_cap'), '0')::numeric;
  v_spend   numeric := public.fal_month_spend();
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

  -- BOTH creative-less stages, invisible-first. published_no_creative rows are
  -- already is_active but cannot appear in the feed (video is a hard filter),
  -- so each one generated is an immediate feed gain. An earlier draft selected
  -- only 'awaiting_creative', which would have skipped that entire backlog -
  -- the exact 177 products that justify this driver existing.
  select array_agg(id) into v_ids from (
    select p.id
      from products p
     where public.pipeline_stage(p.*) in ('published_no_creative','awaiting_creative')
     order by (public.pipeline_stage(p.*) = 'published_no_creative') desc, p.created_at
     limit v_n
  ) s;

  if v_ids is null then return jsonb_build_object('queued',0,'reason','nothing_eligible'); end if;
  if p_dry_run then
    return jsonb_build_object('dry_run',true,'would_queue',array_length(v_ids,1),'ids',v_ids);
  end if;

  insert into product_creative (product_id, status)
  select unnest(v_ids), 'pending';

  insert into pipeline_events (product_id, stage, event)
  select unnest(v_ids), 'creative', 'queued';

  return jsonb_build_object('queued',array_length(v_ids,1),'spend',v_spend,'cap',v_cap);
end $$;

select cron.schedule('pipeline-creative-drain', '*/15 * * * *',
                     $$select public.run_pipeline_creative_drain(false)$$);
select cron.alter_job(job_id := (select jobid from cron.job where jobname='pipeline-creative-drain'),
                      active := false);
