-- Async primary-video pipeline: track fal queue request_id + status on
-- products so the fal-webhook can promote 'pending' rows to 'done' when
-- the upstream clip finishes (Seedance i2v takes 60-150s, longer than
-- Supabase Edge Functions' 150s gateway timeout, so we have to submit
-- async and let fal POST back).
--
-- status values: 'pending' (submitted to fal queue), 'done' (webhook
-- arrived with video_url), 'failed' (webhook arrived with error).
-- NULL means no video gen has been started for this product.

alter table public.products
  add column if not exists primary_video_request_id text,
  add column if not exists primary_video_status text;

create index if not exists idx_products_primary_video_request_id
  on public.products (primary_video_request_id)
  where primary_video_request_id is not null;
