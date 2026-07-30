-- Every pipeline policy value lives here, not in code constants. All flags
-- default OFF: a missing or unparseable setting must mean "do nothing".
insert into public.app_settings (key, value) values
  ('pipeline_enabled',                  'false'),
  ('pipeline_creative_enabled',         'false'),
  ('pipeline_autopublish_enabled',      'false'),
  ('pipeline_creatives_per_day',        '40'),
  ('pipeline_creative_monthly_usd_cap', '50'),   -- deliberately low until the
                                                 -- canary reports real cost
  ('pipeline_min_image_score',          '0.5'),
  ('pipeline_min_images',               '2'),
  ('pipeline_require_person_free',      'true')
on conflict (key) do nothing;

create or replace function public.admin_set_pipeline_setting(p_key text, p_value text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;
  if p_key not like 'pipeline\_%' then
    raise exception 'invalid key: %', p_key;
  end if;
  -- Allowlist by existence rather than a hardcoded key list, so this function
  -- cannot drift out of sync with the settings above.
  if not exists (select 1 from public.app_settings where key = p_key) then
    raise exception 'unknown key: %', p_key;
  end if;
  update public.app_settings set value = p_value, updated_at = now() where key = p_key;
end $$;

-- Flips the flag AND the crons together. The seeding feature's switches did not
-- stick precisely because those two were separate: app_settings said off while
-- pg_cron kept its own `active` state.
create or replace function public.set_pipeline_master(p_on boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
declare r record;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;
  update public.app_settings
     set value = case when p_on then 'true' else 'false' end, updated_at = now()
   where key = 'pipeline_enabled';
  for r in select jobid from cron.job where jobname like 'pipeline-%' loop
    perform cron.alter_job(job_id := r.jobid, active := p_on);
  end loop;
end $$;

create or replace function public.pipeline_cron_status()
returns table(jobname text, schedule text, active boolean, last_status text, last_run timestamptz)
language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;
  return query
    select j.jobname::text, j.schedule::text, j.active, d.status::text, d.start_time
      from cron.job j
      left join lateral (
        select r.status, r.start_time from cron.job_run_details r
         where r.jobid = j.jobid order by r.start_time desc limit 1
      ) d on true
     where j.jobname like 'pipeline-%'
     order by j.jobname;
end $$;
