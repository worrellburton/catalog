-- Catalog Seeding — master switch. One call flips the kill-switch AND every
-- seeding cron's active state together, so the operator can fully start/stop
-- the whole system (loop + all crons) in one click. is_admin gated.
-- See docs/CATALOG_SEEDING.md.

create or replace function public.set_seeding_master(p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;

  insert into public.app_settings (key, value)
  values ('seeding_enabled', case when p_on then 'true' else 'false' end)
  on conflict (key) do update set value = excluded.value, updated_at = now();

  for r in select jobid from cron.job where jobname like 'seeding-%' loop
    perform cron.alter_job(job_id := r.jobid, active := p_on);
  end loop;
end $$;

grant execute on function public.set_seeding_master(boolean) to authenticated, service_role;
