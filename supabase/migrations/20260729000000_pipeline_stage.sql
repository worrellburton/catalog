-- Derived pipeline position. NEVER stored. Every panel and both drivers use
-- this one definition so no two numbers on the dashboard can disagree.
-- STABLE (not IMMUTABLE) because it reads product_creative.
--
-- CASE arms are ORDER-DEPENDENT: published / published_no_creative must be
-- evaluated before the scrape and verify arms, or an active product carrying a
-- stale scrape_status would be misreported as still in the funnel.
create or replace function public.pipeline_stage(p public.products)
returns text language sql stable as $$
  select case
    when p.is_active and p.primary_video_url is not null then 'published'
    -- live but invisible: video is a hard feed filter (product-creative.ts:387)
    when p.is_active and p.primary_video_url is null     then 'published_no_creative'
    when p.scrape_status = 'pending'                     then 'discovered'
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
  r.id := gen_random_uuid();          -- detach from real product_creative rows

  r.is_active := true;  r.primary_video_url := 'https://x/v.mp4';
  got := public.pipeline_stage(r);
  assert got = 'published', 'expected published, got ' || got;

  r.primary_video_url := null;
  got := public.pipeline_stage(r);
  assert got = 'published_no_creative', 'expected published_no_creative, got ' || got;

  r.is_active := false; r.scrape_status := 'pending';
  got := public.pipeline_stage(r);
  assert got = 'discovered', 'expected discovered, got ' || got;

  r.scrape_status := 'failed'; r.images := '[]'::jsonb;
  got := public.pipeline_stage(r);
  assert got = 'scrape_failed', 'expected scrape_failed, got ' || got;

  -- a failed scrape WITH a usable gallery is not terminal
  r.images := '["https://x/a.jpg"]'::jsonb; r.image_verified := null;
  got := public.pipeline_stage(r);
  assert got = 'unverified', 'failed scrape w/ images should continue, got ' || got;

  r.image_verified := true; r.image_verify_note := 'needs_review:dead';
  got := public.pipeline_stage(r);
  assert got = 'needs_review', 'expected needs_review, got ' || got;

  r.image_verify_note := 'clean';
  r.styling_metadata := '{}'::jsonb;
  got := public.pipeline_stage(r);
  assert got = 'blocked:occasion', 'expected blocked:occasion, got ' || got;

  r.styling_metadata := '{"occasion":"date night"}'::jsonb;
  got := public.pipeline_stage(r);
  assert got = 'awaiting_creative', 'expected awaiting_creative, got ' || got;

  r.primary_video_url := 'https://x/v.mp4';
  got := public.pipeline_stage(r);
  assert got = 'ready_to_publish', 'expected ready_to_publish, got ' || got;

  return 'ok';
end $$;
