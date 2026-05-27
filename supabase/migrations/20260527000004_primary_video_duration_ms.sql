-- Wall-clock duration of each primary-video generation in ms.
-- Populated by generate-primary-video when fal.ai returns. The admin
-- progress bar averages this column over past runs to estimate ETA
-- for the next generation.
alter table public.products
  add column if not exists primary_video_duration_ms integer;

create or replace function public.avg_primary_video_duration_ms()
returns table(avg_ms double precision, n bigint)
language sql
stable
security definer
set search_path = public
as $$
  select avg(primary_video_duration_ms)::double precision as avg_ms,
         count(*)::bigint as n
    from public.products
   where primary_video_duration_ms is not null
     and primary_video_duration_ms > 0;
$$;

grant execute on function public.avg_primary_video_duration_ms() to authenticated;
