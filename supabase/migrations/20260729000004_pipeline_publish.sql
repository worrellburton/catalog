-- Publish driver. Promote-only: it NEVER sets is_active = false. Mirrors the
-- contract of the existing run_seeding_activation().
--
-- Note the chain this implies: 'ready_to_publish' requires primary_video_url,
-- so nothing can auto-publish before it has a creative. Products flow
-- awaiting_creative -> (drain) -> creative_pending -> ready_to_publish ->
-- (publish) -> published. The two drivers are ordered by construction, not by
-- scheduling luck.
create or replace function public.run_pipeline_publish(p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_enabled boolean := coalesce((select value from app_settings where key='pipeline_enabled'), 'false') = 'true';
  v_pub_on  boolean := coalesce((select value from app_settings where key='pipeline_autopublish_enabled'), 'false') = 'true';
  -- Defaults here are deliberately RESTRICTIVE, not permissive: a missing
  -- setting must publish nothing, so score defaults to 1 and min_images to 99.
  v_score   numeric := coalesce((select value from app_settings where key='pipeline_min_image_score'), '1')::numeric;
  v_imgs    int     := coalesce((select value from app_settings where key='pipeline_min_images'), '99')::int;
  v_pfree   boolean := coalesce((select value from app_settings where key='pipeline_require_person_free'), 'true') = 'true';
  v_ids     uuid[];
begin
  if not v_enabled then return jsonb_build_object('skipped','pipeline_disabled'); end if;
  if not v_pub_on  then return jsonb_build_object('skipped','autopublish_disabled'); end if;

  select array_agg(p.id) into v_ids
    from products p
   where public.pipeline_stage(p.*) = 'ready_to_publish'
     and coalesce(p.image_verify_score, 0) >= v_score
     and coalesce(jsonb_array_length(p.images), 0) >= v_imgs
     and (not v_pfree or p.primary_image_person_free is true);

  if v_ids is null then return jsonb_build_object('published',0); end if;
  if p_dry_run then
    return jsonb_build_object('dry_run',true,'would_publish',array_length(v_ids,1),'ids',v_ids);
  end if;

  update products set is_active = true where id = any(v_ids);

  insert into pipeline_events (product_id, stage, event, detail)
  select unnest(v_ids), 'publish', 'published',
         jsonb_build_object('min_score',v_score,'min_images',v_imgs,'require_person_free',v_pfree);

  return jsonb_build_object('published',array_length(v_ids,1));
end $$;

select cron.schedule('pipeline-publish', '*/15 * * * *',
                     $$select public.run_pipeline_publish(false)$$);
select cron.alter_job(job_id := (select jobid from cron.job where jobname='pipeline-publish'),
                      active := false);
