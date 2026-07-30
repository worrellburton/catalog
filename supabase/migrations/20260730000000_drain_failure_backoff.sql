-- The I8 guard added in 20260729000008 was too absolute. It excluded any
-- product with ANY failed creative, forever:
--     and not exists (select 1 from product_creative c
--                      where c.product_id = p.id and c.status = 'failed')
--
-- The canary proved why that is wrong. All 3 hand-picked renders failed on an
-- INVALID GOOGLE_API_KEY - a transient, environment-wide credential fault with
-- nothing to do with the products. Under the old guard those 3 healthy
-- products (score 1.0, 10 images, person-free) would have been permanently
-- benched by an outage, and rotating the key would silently leave them behind.
--
-- Replaced with bounded backoff, which separates the two cases the old rule
-- could not tell apart:
--   * fewer than 3 failures -> retry, but not within 6 hours, so a credential
--                              or API outage clears on its own
--   * 3 or more failures    -> stop; this product genuinely will not render
--
-- Also: the daily quota now counts only non-failed rows. A failed render bills
-- nothing, so letting failures consume the quota would let one outage burn a
-- whole day's budget without producing a single video.
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
   where created_at >= date_trunc('day', now()) and status <> 'failed';
  v_n := least(v_per_day - v_today, 25);
  if v_n <= 0 then return jsonb_build_object('skipped','daily_limit','today',v_today); end if;

  select array_agg(id) into v_ids from (
    select p.id
      from products p
     where public.pipeline_stage(p.*) in ('published_no_creative','awaiting_creative')
       and p.image_verified is not false
       and coalesce(p.styling_metadata->>'occasion','') <> ''
       and (select count(*) from product_creative c
             where c.product_id = p.id and c.status = 'failed') < 3
       and not exists (select 1 from product_creative c
                        where c.product_id = p.id and c.status = 'failed'
                          and c.created_at > now() - interval '6 hours')
     order by (public.pipeline_stage(p.*) = 'published_no_creative') desc, p.created_at
     limit v_n
  ) s;

  if v_ids is null then return jsonb_build_object('queued',0,'reason','nothing_eligible'); end if;
  if p_dry_run then
    return jsonb_build_object('dry_run',true,'would_queue',array_length(v_ids,1),'ids',v_ids);
  end if;

  insert into product_creative (product_id, status, enabled)
  select unnest(v_ids), 'pending', true;

  insert into pipeline_events (product_id, stage, event)
  select unnest(v_ids), 'creative', 'queued';

  return jsonb_build_object('queued',array_length(v_ids,1),'spend',v_spend,'cap',v_cap);
end $$;
revoke execute on function public.run_pipeline_creative_drain(boolean) from public, anon, authenticated;
grant  execute on function public.run_pipeline_creative_drain(boolean) to service_role;
