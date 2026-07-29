-- Per-product pipeline journey, scrape -> publish, reconstructed from
-- timestamps that already exist on the row. Deliberately NOT built on
-- pipeline_events: that log only started recording 2026-07-29, so a journey
-- sourced from it would be blank for all 455 existing products.
--
-- NOTE on ordering: these timestamps are LAST-completed, not first-reached.
-- verify and enrich re-run on existing products, so a later stage can carry an
-- earlier date. The UI orders by pipeline position (the meaningful axis) and
-- marks the backwards step "re-run" rather than implying time reversed.
create or replace function public.product_journey(p_id uuid)
returns jsonb language plpgsql stable as $$
declare
  p public.products;
  v_steps jsonb := '[]'::jsonb;
  v_stage text; v_blocked text; v_unblock text;
  v_occasions int; v_creatives jsonb;
  v_min_score numeric; v_min_imgs int; v_pfree_req boolean;
begin
  select * into p from public.products where id = p_id;
  if not found then return jsonb_build_object('error','not found'); end if;

  v_stage := public.pipeline_stage(p);
  select count(*) into v_occasions
    from jsonb_array_elements_text(
      case when jsonb_typeof(p.styling_metadata->'occasion') = 'array'
           then p.styling_metadata->'occasion' else '[]'::jsonb end);

  v_steps := jsonb_build_array(
    jsonb_build_object('key','discovered','label','Discovered','at',p.created_at,
      'detail', coalesce(p.source,'manual') || ' · ' || coalesce(p.url,'no url')),
    jsonb_build_object('key','scraped','label','Scraped','at',p.scraped_at,
      'detail', case when p.scrape_status = 'done'
                     then coalesce(jsonb_array_length(p.images),0) || ' images · '
                          || coalesce(p.price,'no price') || ' · ' || coalesce(p.type,'no type')
                     when p.scrape_status = 'failed'
                     then 'failed: ' || left(coalesce(p.scrape_error,'unknown'),80)
                     else coalesce(p.scrape_status,'pending') end,
      'failed', p.scrape_status = 'failed'),
    jsonb_build_object('key','verified','label','Images verified','at',p.image_verified_at,
      'detail', case when p.image_verified_at is null then 'not yet checked'
                     else coalesce(round(p.image_verify_score::numeric,3)::text,'—') || ' score · '
                          || case when p.primary_image_person_free then 'person-free'
                                  when p.primary_image_person_free is false then 'on-model'
                                  else 'unknown' end
                          || ' · ' || coalesce(p.image_verify_note,'') end,
      'failed', p.image_verify_note like 'needs_review%'),
    jsonb_build_object('key','enriched','label','Enriched','at',
      greatest(p.haiku_context_at, p.embedded_at),
      'detail', v_occasions || ' occasions · '
                || case when p.embedding is not null then 'embedded' else 'not embedded' end
                || case when p.haiku_context is not null then ' · context' else '' end,
      'failed', v_occasions = 0),
    jsonb_build_object('key','creative','label','Creative generated','at',p.primary_video_generated_at,
      'detail', case when p.primary_video_url is null then 'no video yet' else 'video ready' end),
    jsonb_build_object('key','published','label','Published','at',
      case when p.is_active and p.primary_video_url is not null then p.primary_video_generated_at end,
      'detail', case when p.is_active and p.primary_video_url is not null then 'live in feed'
                     when p.is_active then 'active but INVISIBLE — video is a hard feed filter'
                     else 'not active' end)
  );

  select coalesce(jsonb_agg(jsonb_build_object(
           'status', c.status, 'enabled', c.enabled, 'model', c.model,
           'cost_usd', c.cost_usd, 'completed_at', c.completed_at,
           'has_video', c.video_url is not null) order by c.created_at), '[]'::jsonb)
    into v_creatives from public.product_creative c where c.product_id = p_id;

  v_min_score := coalesce((select value from app_settings where key='pipeline_min_image_score'),'1')::numeric;
  v_min_imgs  := coalesce((select value from app_settings where key='pipeline_min_images'),'99')::int;
  v_pfree_req := coalesce((select value from app_settings where key='pipeline_require_person_free'),'true')='true';

  v_blocked := case v_stage
    when 'discovered'            then 'Waiting for the scraper to pick it up'
    when 'scraping'              then 'Scraper is working on it now'
    when 'scrape_failed'         then 'Scrape failed and no images were recovered'
    when 'unverified'            then 'Images have not been verified yet'
    when 'needs_review'          then 'Image verification flagged it: ' || coalesce(p.image_verify_note,'')
    when 'blocked:occasion'      then 'No occasion text, so it cannot be retrieved by search or the stylist'
    when 'awaiting_creative'     then 'No video yet, and video is a hard filter on the feed'
    when 'creative_pending'      then 'A video is being generated'
    when 'ready_to_publish'      then 'Has a video, waiting on the publish policy'
    when 'published_no_creative' then 'Live but INVISIBLE — it is active with no video'
    else null end;

  v_unblock := case v_stage
    when 'scrape_failed'         then 'Re-source the URL, or retire the product'
    when 'unverified'            then 'Runs automatically; verify-product-image has not fired yet'
    when 'needs_review'          then 'Review the images by hand, or let the reconciler re-source them'
    when 'blocked:occasion'      then 'The occasion-enrich cron fills this every 15 minutes'
    when 'awaiting_creative'     then 'Enable the creative drain on /admin/pipeline'
    when 'ready_to_publish'      then 'Needs score >= ' || v_min_score || ', >= ' || v_min_imgs
                                      || ' images' || case when v_pfree_req then ', person-free primary' else '' end
    when 'published_no_creative' then 'Generate a creative — the drain picks these first'
    else null end;

  return jsonb_build_object(
    'id', p.id, 'brand', p.brand, 'name', p.name, 'type', p.type, 'price', p.price,
    'url', p.url, 'image', p.primary_image_url, 'source', p.source,
    'is_active', p.is_active, 'stage', v_stage,
    'blocked_by', v_blocked, 'unblock_with', v_unblock,
    'steps', v_steps, 'creatives', v_creatives,
    'total_seconds', extract(epoch from (coalesce(p.primary_video_generated_at, now()) - p.created_at))
  );
end $$;

-- Entry point into the journey view. Without this the funnel is a dead end:
-- it says 170 products are stuck at published_no_creative and gives you no way
-- to open one. Oldest-first, so the link goes to the longest-stuck product.
create or replace function public.pipeline_stage_examples(p_per_stage int default 3)
returns table(stage text, id uuid, brand text, name text) language sql stable as $$
  select stage, id, brand, name from (
    select public.pipeline_stage(p.*) as stage, p.id, p.brand, p.name,
           row_number() over (partition by public.pipeline_stage(p.*)
                              order by p.created_at) as rn
      from public.products p
  ) s
  where rn <= greatest(1, p_per_stage)
  order by stage, rn;
$$;
