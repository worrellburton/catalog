-- In/out trim window (seconds) selected in the create-look video trimmer.
-- NULL = play the whole video. Consumer players loop [trim_start, trim_end].
alter table public.look_videos
  add column if not exists trim_start double precision,
  add column if not exists trim_end   double precision;

comment on column public.look_videos.trim_start is 'Trimmer in-point (seconds); null = start of video';
comment on column public.look_videos.trim_end   is 'Trimmer out-point (seconds); null = end of video';
