-- Drag-rank persistence. Accepts an ordered array of slugs and
-- writes sort_order = index for each one, lowest index = pinned-
-- highest. Single round-trip even for 50+ catalogs.

create or replace function public.admin_set_catalog_sort_order(p_slugs text[])
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

  update public.catalogs c
  set sort_order = (
    select i - 1 from unnest(p_slugs) with ordinality as t(slug, i)
    where t.slug = c.slug
  ),
      updated_at = now()
  where c.slug = any(p_slugs);

  return true;
end;
$$;

grant execute on function public.admin_set_catalog_sort_order(text[]) to authenticated;
