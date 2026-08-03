-- Review follow-ups on reap_stuck_generation_jobs.
--
-- Clamp the caller-supplied interval. C2 revoked anon access, but the
-- parameter remains the sharpest edge on this function: a mistaken
-- reap_stuck_generation_jobs('-1 second') from a service-role script would
-- fail every in-flight job. 30 minutes is well beyond any real render.
-- Verified: with a fresh 'running' row present, a '-1 second' call now reaps 0
-- and the row survives.
--
-- The coalesce fallback covers a NULL-timestamp row defensively. NOTE: this is
-- currently unreachable - generation_jobs.started_at is NOT NULL, so the
-- review's "both timestamps null" case cannot occur. Kept as a cheap guard in
-- case that constraint is ever relaxed.
create or replace function public.reap_stuck_generation_jobs(p_older_than interval default '2 hours')
returns int language plpgsql security definer set search_path to 'public' as $$
declare
  v_n int;
  v_window interval := greatest(p_older_than, interval '30 minutes');
begin
  with stuck as (
    update public.generation_jobs
       set status = 'failed',
           result_message = coalesce(result_message, 'reaped: stuck in running'),
           ended_at = now()
     where status = 'running'
       and coalesce(started_at, ended_at, '-infinity'::timestamptz) < now() - v_window
    returning id, kind
  )
  select count(*) into v_n from stuck;

  if v_n > 0 then
    insert into public.pipeline_events (stage, event, detail)
    values ('generation_jobs', 'failed',
            jsonb_build_object('reaped', v_n, 'window', v_window::text));
  end if;
  return v_n;
end $$;

revoke execute on function public.reap_stuck_generation_jobs(interval) from public, anon, authenticated;
grant  execute on function public.reap_stuck_generation_jobs(interval) to service_role;
