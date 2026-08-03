-- generation_watchdog() only ever reconciled user_generations, so 217
-- generation_jobs of kind 'primary-video' sat 'running' from 2026-06-25 until
-- 2026-07-28 with nothing to notice. This reaps them.
--
-- Safe to schedule ACTIVE: it only marks already-dead rows failed and cannot
-- spend money or publish anything.
create or replace function public.reap_stuck_generation_jobs(p_older_than interval default '2 hours')
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_n int;
begin
  with stuck as (
    update public.generation_jobs
       set status = 'failed',
           result_message = coalesce(result_message, 'reaped: stuck in running'),
           ended_at = now()
     where status = 'running'
       and coalesce(started_at, ended_at) < now() - p_older_than
    returning id, kind
  )
  select count(*) into v_n from stuck;

  if v_n > 0 then
    insert into public.pipeline_events (stage, event, detail)
    values ('generation_jobs', 'failed', jsonb_build_object('reaped', v_n));
  end if;
  return v_n;
end $$;

select cron.schedule('pipeline-reap-jobs', '*/30 * * * *',
                     $$select public.reap_stuck_generation_jobs()$$);
