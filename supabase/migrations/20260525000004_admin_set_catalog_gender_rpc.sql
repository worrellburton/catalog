-- Admin write path for catalogs.gender. Parallels
-- admin_update_catalog_toggles (introduced earlier when the boolean
-- toggles needed an RPC because there was no broad UPDATE RLS on
-- catalogs). SECURITY DEFINER + admin gate inside, same shape.

create or replace function public.admin_set_catalog_gender(
  p_slug text,
  p_gender text
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

  if p_gender not in ('all', 'men', 'women', 'unisex') then
    raise exception 'gender must be one of all / men / women / unisex'
      using errcode = '22023';
  end if;

  update public.catalogs
  set gender = p_gender,
      updated_at = now()
  where slug = p_slug;

  return found;
end;
$$;

grant execute on function public.admin_set_catalog_gender(text, text) to authenticated;
