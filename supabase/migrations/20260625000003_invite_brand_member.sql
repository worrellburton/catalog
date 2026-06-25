-- Let a BRAND owner/admin invite teammates from the portal Team page.
--
-- A brand admin is not a platform admin, so they can't read arbitrary profiles
-- by email or write brand_invites (those are platform-admin-gated). This RPC
-- runs SECURITY DEFINER but only after confirming the caller administers the
-- target brand: it resolves the email to an existing profile (immediate
-- membership) or creates a pending invite (auto-accepted on first sign-in by the
-- existing profiles trigger).

create or replace function public.invite_brand_member(
  p_brand_id uuid, p_email text, p_role text default 'creative'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_profile uuid;
  v_token   text;
  v_status  text;
begin
  if not (public.is_brand_member(p_brand_id, 'admin') or public.is_platform_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_email is null or position('@' in p_email) = 0 then raise exception 'invalid email'; end if;
  if p_role not in ('owner', 'admin', 'finance', 'creative') then p_role := 'creative'; end if;

  select id into v_profile from public.profiles where lower(email) = lower(p_email) limit 1;

  if v_profile is not null then
    insert into public.brand_members (brand_id, user_id, role, status, invited_by)
    values (p_brand_id, v_profile, p_role, 'active', auth.uid())
    on conflict (brand_id, user_id) do update set role = excluded.role, status = 'active';
    v_status := 'active'; v_token := null;
  else
    update public.brand_invites set status = 'revoked'
     where brand_id = p_brand_id and lower(email) = lower(p_email) and status = 'pending';
    insert into public.brand_invites (brand_id, email, role, invited_by)
    values (p_brand_id, lower(p_email), p_role, auth.uid())
    returning token into v_token;
    v_status := 'pending';
  end if;

  return jsonb_build_object('status', v_status, 'token', v_token);
end;
$$;

grant execute on function public.invite_brand_member(uuid, text, text) to authenticated;

-- Brand owner/admin may read + revoke their own brand's pending invites
-- (additive to the existing platform-admin-only policy).
drop policy if exists invites_brand_admin_read on public.brand_invites;
create policy invites_brand_admin_read on public.brand_invites for select
  using (public.is_brand_member(brand_id, 'admin') or public.is_platform_admin());

drop policy if exists invites_brand_admin_revoke on public.brand_invites;
create policy invites_brand_admin_revoke on public.brand_invites for update
  using (public.is_brand_member(brand_id, 'admin') or public.is_platform_admin())
  with check (public.is_brand_member(brand_id, 'admin') or public.is_platform_admin());
