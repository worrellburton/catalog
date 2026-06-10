-- When a user_generations row's video_url changes (a regen finished
-- and the worker wrote the new fal.media URL), propagate that new
-- URL into the matching looks_creative row so the consumer feed +
-- creator catalog show the regenerated video without the admin
-- having to manually re-publish.

create or replace function public.sync_looks_creative_from_generation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.video_url is null then
    return NEW;
  end if;
  if OLD.video_url is not distinct from NEW.video_url then
    return NEW;
  end if;
  update public.looks_creative lc
     set video_url = NEW.video_url,
         thumbnail_url = null
   where lc.is_primary = true
     and lc.look_id in (
       select id from public.looks
        where source_generation_id = NEW.id
     );
  return NEW;
end
$$;

drop trigger if exists trg_sync_looks_creative_from_generation on public.user_generations;

create trigger trg_sync_looks_creative_from_generation
after update of video_url on public.user_generations
for each row
when (NEW.video_url is distinct from OLD.video_url)
execute function public.sync_looks_creative_from_generation();

comment on function public.sync_looks_creative_from_generation() is
  'Propagates user_generations.video_url changes into looks_creative for any look promoted from this generation. Fires after a regen completes so the consumer feed picks up the new video without manual re-publishing.';
