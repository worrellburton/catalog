-- Admin write path for catalogs.is_featured. Parallels
-- admin_set_catalog_gender. SECURITY DEFINER, admin gate inside.

create or replace function public.admin_set_catalog_featured(
  p_slug text,
  p_featured boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (is_admin = true or role in ('admin', 'super_admin'))
  ) then
    raise exception 'Admin privileges required' using errcode = '42501';
  end if;

  update public.catalogs
  set is_featured = p_featured,
      updated_at = now()
  where slug = p_slug;

  return found;
end;
$$;

grant execute on function public.admin_set_catalog_featured(text, boolean) to authenticated;
