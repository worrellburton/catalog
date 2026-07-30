-- Found by an end-to-end test 2026-07-29: the scraper sets
-- scrape_status='processing' while it works, and pipeline_stage() had no arm
-- for it. An actively-scraping product fell through to 'unverified', so the
-- funnel could not distinguish "being fetched right now" from "fetched,
-- awaiting image verification" - and the INGEST half of the pipeline was
-- effectively invisible on the health page, which is exactly what the founder
-- reported seeing.
create or replace function public.pipeline_stage(p public.products)
returns text language sql stable as $$
  select case
    when p.is_active and p.primary_video_url is not null then 'published'
    when p.is_active and p.primary_video_url is null     then 'published_no_creative'
    when p.scrape_status = 'pending'                     then 'discovered'
    when p.scrape_status = 'processing'                  then 'scraping'
    when p.scrape_status = 'failed'
         and coalesce(jsonb_array_length(p.images), 0) = 0 then 'scrape_failed'
    when p.image_verified is null                        then 'unverified'
    when p.image_verify_note like 'needs_review%'        then 'needs_review'
    when coalesce(p.styling_metadata->>'occasion','') = '' then 'blocked:occasion'
    when p.primary_video_url is not null                 then 'ready_to_publish'
    when exists (
      select 1 from public.product_creative c
       where c.product_id = p.id
         and c.status in ('pending','queued','generating','running')
    ) then 'creative_pending'
    else 'awaiting_creative'
  end
$$;

create or replace function public.test_pipeline_stage()
returns text language plpgsql as $$
declare r public.products; got text;
begin
  select * into r from public.products limit 1;
  r.id := gen_random_uuid();
  r.is_active := true;  r.primary_video_url := 'https://x/v.mp4';
  assert public.pipeline_stage(r) = 'published';
  r.primary_video_url := null;
  assert public.pipeline_stage(r) = 'published_no_creative';
  r.is_active := false; r.scrape_status := 'pending';
  assert public.pipeline_stage(r) = 'discovered';
  r.scrape_status := 'processing';
  got := public.pipeline_stage(r);
  assert got = 'scraping', 'expected scraping, got ' || got;
  r.scrape_status := 'failed'; r.images := '[]'::jsonb;
  assert public.pipeline_stage(r) = 'scrape_failed';
  r.images := '["https://x/a.jpg"]'::jsonb; r.image_verified := null;
  assert public.pipeline_stage(r) = 'unverified';
  r.image_verified := true; r.image_verify_note := 'needs_review:dead';
  assert public.pipeline_stage(r) = 'needs_review';
  r.image_verify_note := 'clean'; r.styling_metadata := '{}'::jsonb;
  assert public.pipeline_stage(r) = 'blocked:occasion';
  r.styling_metadata := '{"occasion":"date night"}'::jsonb;
  assert public.pipeline_stage(r) = 'awaiting_creative';
  r.primary_video_url := 'https://x/v.mp4';
  assert public.pipeline_stage(r) = 'ready_to_publish';
  return 'ok';
end $$;
