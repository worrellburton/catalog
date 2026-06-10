-- Trim window (seconds) for the consumer-facing creative, so look video
-- players can loop [trim_start, trim_end]. NULL = play the whole video.
-- Mirrors look_videos.trim_start/end; the creator's trimmer writes both.
alter table public.looks_creative
  add column if not exists trim_start double precision,
  add column if not exists trim_end   double precision;

comment on column public.looks_creative.trim_start is 'Playback in-point (seconds); null = start';
comment on column public.looks_creative.trim_end   is 'Playback out-point (seconds); null = end';
