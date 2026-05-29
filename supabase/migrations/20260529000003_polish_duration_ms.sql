-- Mirror primary_video_duration_ms for the polish path. The
-- polish-primary-image edge function records the Gemini call time so
-- the Generation Queue can roll a per-kind rolling-average ETA.

alter table public.products
  add column if not exists primary_image_polish_duration_ms integer;
