-- Make "video generated + enabled → on feed" a hard guarantee.
--
-- The consumer feed (home + search) keys off products.primary_video_url. Some
-- active products had their generated clip only in the legacy product_creative
-- table, so they never appeared on the feed. Two parts:
--   1. Backfill: promote each active product's best live creative into
--      primary_video_url (one-time, fixes the 23 stragglers).
--   2. Trigger: auto-promote any future creative that goes live/done into
--      primary_video_url when the product doesn't already have one — so the feed
--      guarantee holds regardless of which generation path wrote the creative.
-- primary_video_url stays the single source of truth; existing primary videos
-- (the admin's chosen clip) are never overwritten.

-- 1. One-time backfill (active products missing a primary video) ──────────────
update public.products p set
  primary_video_url          = c.video_url,
  primary_image_url          = coalesce(p.primary_image_url, c.thumbnail_url),
  primary_video_generated_at = coalesce(p.primary_video_generated_at, now())
from (
  select distinct on (product_id) product_id, video_url, thumbnail_url
  from public.product_creative
  where status in ('live','done') and enabled = true and video_url is not null
  order by product_id, is_elite desc, completed_at desc nulls last, created_at desc
) c
where p.id = c.product_id
  and p.is_active = true
  and p.primary_video_url is null;

-- 2. Auto-promote trigger for future creatives ───────────────────────────────
create or replace function public.promote_creative_to_primary_video()
returns trigger
language plpgsql
security definer
as $function$
begin
  if NEW.status in ('live','done')
     and NEW.enabled = true
     and NEW.video_url is not null then
    update public.products p
       set primary_video_url          = NEW.video_url,
           primary_image_url          = coalesce(p.primary_image_url, NEW.thumbnail_url),
           primary_video_generated_at = coalesce(p.primary_video_generated_at, now())
     where p.id = NEW.product_id
       and p.primary_video_url is null;   -- never clobber an existing primary
  end if;
  return NEW;
end;
$function$;

drop trigger if exists trg_promote_creative_to_primary_video on public.product_creative;
create trigger trg_promote_creative_to_primary_video
after insert or update on public.product_creative
for each row
execute function public.promote_creative_to_primary_video();
