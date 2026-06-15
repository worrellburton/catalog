-- Auto-regenerate the primary-video poster on EVERY new/changed primary
-- video, not only when no poster exists yet.
--
-- Before: the trigger fired only when primary_video_poster_url was null, so a
-- product that already had a poster (extracted from an OLDER video) kept that
-- stale poster after its video was regenerated — the poster no longer matched
-- the clip. AND the Modal webhook itself skips when record.primary_video_poster_url
-- is set ("poster already set"). So now we (1) fire whenever primary_video_url
-- changes regardless of an existing poster, and (2) send the record with the
-- poster field forced to null so the Modal job re-extracts frame 0 from the
-- CURRENT video.
--
-- No loop: the poster write touches only primary_video_poster_url, which this
-- `update of primary_video_url` trigger does not watch.
create or replace function public.notify_generate_primary_poster()
returns trigger
language plpgsql
security definer
as $$
begin
  if NEW.primary_video_url is not null
     and (TG_OP = 'INSERT' or NEW.primary_video_url is distinct from OLD.primary_video_url)
  then
    perform net.http_post(
      url     := 'https://catalog--generate-primary-poster.modal.run',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := jsonb_build_object(
                   'record',
                   to_jsonb(NEW) || jsonb_build_object('primary_video_poster_url', null)
                 )
    );
  end if;
  return NEW;
end;
$$;

-- The trigger itself is unchanged (still AFTER INSERT OR UPDATE OF
-- primary_video_url) — see 20260601000008_trg_generate_primary_poster.sql.
