-- Auto-generate a 3:4 poster whenever a product gets a primary video.
--
-- The feed surfaces any product where primary_video_url IS NOT NULL and
-- uses primary_video_poster_url as the <video> poster. Without a poster it
-- falls back to the square primary_image_url, which object-fit:cover
-- magnifies into the 3:4 card (the "zoomed in" look). This trigger fires
-- the Modal endpoint that extracts the clip's own first frame (native 3:4)
-- and writes primary_video_poster_url — so every new primary video gets a
-- matching poster automatically, no manual backfill.
--
-- Mirrors the existing notify_modal_generate_creative() pattern: a
-- SECURITY DEFINER function using pg_net (net.http_post) to POST the new
-- row to a https://catalog--<label>.modal.run endpoint.
--
-- Covers every path that sets primary_video_url:
--   • fal-webhook (generate-primary-video async pipeline)
--   • promote_creative_to_primary_video() (creative → product autopromote)
--   • manual admin edits
-- The Modal cron (generate_pending) is the safety net if the endpoint is
-- down when the trigger fires.

create or replace function public.notify_generate_primary_poster()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Fire only when a primary video URL appears (or changes) and no poster
  -- exists yet. The poster-write UPDATE itself can't re-fire this: it
  -- targets only primary_video_poster_url (so `update of primary_video_url`
  -- doesn't match), and the poster-null guard would fail anyway.
  if NEW.primary_video_url is not null
     and NEW.primary_video_poster_url is null
     and (TG_OP = 'INSERT' or NEW.primary_video_url is distinct from OLD.primary_video_url)
  then
    perform net.http_post(
      url     := 'https://catalog--generate-primary-poster.modal.run',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := jsonb_build_object('record', row_to_json(NEW))
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_products_generate_primary_poster on public.products;
create trigger trg_products_generate_primary_poster
  after insert or update of primary_video_url on public.products
  for each row
  execute function public.notify_generate_primary_poster();
