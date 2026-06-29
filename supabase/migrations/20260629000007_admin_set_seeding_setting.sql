-- Catalog Seeding — admin-only setter for the seeding kill-switch + budget.
-- app_settings is service-role-write only, so the /admin/seeding page needs a
-- SECURITY DEFINER RPC (is_admin gated, key-allowlisted) to flip the switch.
-- See docs/CATALOG_SEEDING.md.

create or replace function public.admin_set_seeding_setting(p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;
  if p_key not in ('seeding_enabled', 'seeding_monthly_serpapi_cap', 'seeding_serpapi_used_month') then
    raise exception 'invalid key: %', p_key;
  end if;
  insert into public.app_settings (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

grant execute on function public.admin_set_seeding_setting(text, text) to authenticated, service_role;
