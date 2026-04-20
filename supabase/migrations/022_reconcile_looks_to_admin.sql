-- User instruction: admin Content → Looks shows exactly 2 rows
-- (one per creator: Lily Wittman, Garrett). Make the looks table match
-- that state by deleting every look row that isn't one of those two
-- canonical representatives, plus any orphan drafts without videos.
--
-- Keep exactly:
--   • one girl2.mp4 look attributed to @lilywittman
--   • one guy.mp4 look attributed to @garrett

with keepers as (
  select distinct on (video_path) id
    from public.looks
   where video_path in ('girl2.mp4', 'guy.mp4')
     and (status is null or status = 'live')
   order by video_path, created_at
)
delete from public.looks
 where id not in (select id from keepers);
