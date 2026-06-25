-- Self-serve brand creation for the onboarding page.
--
-- When an admin assigns an existing user the platform role 'brand_owner' /
-- 'brand_member' (profiles.role) and that user has no brand yet, the portal
-- shows a "create your brand" page that calls this RPC. It creates the brand +
-- an owner membership for the caller, and links any matching catalog products.
-- SECURITY DEFINER so it can write brands/brand_members (admin-only RLS) on the
-- caller's behalf, but it raises unless the caller actually holds a brand role.

create or replace function public.create_my_brand(
  p_name text, p_logo_url text default null, p_website text default null, p_description text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_role   text;
  v_slug   text;
  v_brand  uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;

  select role into v_role from public.profiles where id = v_uid;
  if coalesce(v_role, '') not in ('brand_owner', 'brand_member') and not public.is_platform_admin() then
    raise exception 'not allowed to create a brand' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'brand name required'; end if;

  v_slug := trim(both '-' from lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '-', 'g')));
  if v_slug = '' then v_slug := 'brand'; end if;
  if exists (select 1 from public.brands where slug = v_slug) then
    v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  end if;

  insert into public.brands (slug, name, canonical_brand, logo_url, website, description)
  values (
    v_slug, trim(p_name), trim(p_name),
    nullif(trim(coalesce(p_logo_url, '')), ''),
    nullif(trim(coalesce(p_website, '')), ''),
    nullif(trim(coalesce(p_description, '')), '')
  )
  returning id into v_brand;

  insert into public.brand_members (brand_id, user_id, role, status)
  values (v_brand, v_uid, 'owner', 'active')
  on conflict (brand_id, user_id) do update set status = 'active', role = 'owner';

  -- "old base": link existing catalog products that match this brand name.
  update public.products set brand_id = v_brand
   where brand_id is null and lower(brand) = lower(trim(p_name));

  return jsonb_build_object('brand_id', v_brand, 'slug', v_slug);
end;
$$;

grant execute on function public.create_my_brand(text, text, text, text) to authenticated;
