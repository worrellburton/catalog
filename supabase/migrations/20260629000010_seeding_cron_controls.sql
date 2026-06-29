-- Catalog Seeding — admin-readable cron status + pause/resume toggle, so the
-- /admin/seeding "Automation" panel can show + control the seeding crons.
-- is_admin gated; only seeding-* jobs are exposed/togglable. See docs/CATALOG_SEEDING.md.

create or replace function public.seeding_cron_status()
returns table(jobname text, schedule text, active boolean, last_status text, last_run timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;
  return query
    select j.jobname::text, j.schedule::text, j.active,
           d.status::text, d.start_time
    from cron.job j
    left join lateral (
      select r.status, r.start_time from cron.job_run_details r
      where r.jobid = j.jobid order by r.start_time desc limit 1
    ) d on true
    where j.jobname like 'seeding-%'
    order by j.jobname;
end $$;

grant execute on function public.seeding_cron_status() to authenticated, service_role;

create or replace function public.set_seeding_cron_active(p_jobname text, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  jid bigint;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;
  if p_jobname not like 'seeding-%' then
    raise exception 'invalid job: %', p_jobname;
  end if;
  select jobid into jid from cron.job where jobname = p_jobname;
  if jid is null then raise exception 'job not found: %', p_jobname; end if;
  perform cron.alter_job(job_id := jid, active := p_active);
end $$;

grant execute on function public.set_seeding_cron_active(text, boolean) to authenticated, service_role;
