-- Brand-admin invites + editable brand profile (admin /partners page).
--
-- Flow: a platform admin invites a brand admin by email for a brand. The brand
-- is seeded from our existing catalog ("old base" — link matching products +
-- pull the logo). If the email already has a profile they're added immediately;
-- otherwise a pending invite waits and is auto-accepted the moment that email
-- signs in with Google (trigger on profiles). The invited admin then edits their
-- brand profile in the portal.

-- 1) Editable brand profile fields (name/slug/logo_url already exist).
alter table public.brands add column if not exists website text;
alter table public.brands add column if not exists description text;

-- 2) Pending invites, keyed by email (the person has no profile yet).
create table if not exists public.brand_invites (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.brands(id) on delete cascade,
  email       text not null,
  role        text not null default 'owner' check (role in ('owner','admin','finance','creative')),
  status      text not null default 'pending' check (status in ('pending','accepted','revoked')),
  token       text not null unique default replace(gen_random_uuid()::text, '-', ''),
  invited_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_user_id uuid references public.profiles(id)
);
create index if not exists brand_invites_email_pending_idx on public.brand_invites (lower(email)) where status = 'pending';

alter table public.brand_invites enable row level security;
drop policy if exists invites_admin_all on public.brand_invites;
create policy invites_admin_all on public.brand_invites for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- 3) Auto-accept on sign-in: when a new profile's email matches a pending invite,
--    grant membership and mark the invite accepted. SECURITY DEFINER so it can
--    write brand_members/brand_invites regardless of the signing-in user's RLS.
create or replace function public.accept_brand_invites_for_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.email is null then return NEW; end if;

  insert into public.brand_members (brand_id, user_id, role, status, invited_by)
  select bi.brand_id, NEW.id, bi.role, 'active', bi.invited_by
  from public.brand_invites bi
  where bi.status = 'pending' and lower(bi.email) = lower(NEW.email)
  on conflict (brand_id, user_id) do update set status = 'active', role = excluded.role;

  update public.brand_invites
  set status = 'accepted', accepted_at = now(), accepted_user_id = NEW.id
  where status = 'pending' and lower(email) = lower(NEW.email);

  return NEW;
end;
$$;

drop trigger if exists trg_accept_brand_invites on public.profiles;
create trigger trg_accept_brand_invites
  after insert on public.profiles
  for each row execute function public.accept_brand_invites_for_profile();

-- 4) Admin RPC: create/seed the brand + invite (or grant directly if the email
--    already has a profile). Returns the invite token + seeded counts.
create or replace function public.admin_invite_brand_admin(
  p_email text, p_brand_name text, p_role text default 'owner'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_brand_id  uuid;
  v_slug      text;
  v_canonical text;
  v_logo      text;
  v_profile   uuid;
  v_token     text;
  v_status    text;
  v_linked    int := 0;
begin
  if not public.is_platform_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_email is null or position('@' in p_email) = 0 then raise exception 'invalid email'; end if;
  if coalesce(trim(p_brand_name), '') = '' then raise exception 'brand name required'; end if;
  if p_role not in ('owner','admin','finance','creative') then p_role := 'owner'; end if;

  v_slug := trim(both '-' from lower(regexp_replace(trim(p_brand_name), '[^a-zA-Z0-9]+', '-', 'g')));
  if v_slug = '' then v_slug := 'brand-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8); end if;

  -- "old base": match an existing catalog brand string + its logo.
  select brand into v_canonical from public.products where lower(brand) = lower(trim(p_brand_name)) limit 1;
  v_canonical := coalesce(v_canonical, trim(p_brand_name));
  select logo_url into v_logo from public.brand_logos where lower(brand) = lower(trim(p_brand_name)) limit 1;

  insert into public.brands (slug, name, canonical_brand, logo_url)
  values (v_slug, trim(p_brand_name), v_canonical, v_logo)
  on conflict (slug) do update
    set name = excluded.name,
        canonical_brand = coalesce(public.brands.canonical_brand, excluded.canonical_brand),
        logo_url = coalesce(public.brands.logo_url, excluded.logo_url)
  returning id into v_brand_id;

  -- Link the brand's existing catalog products.
  update public.products set brand_id = v_brand_id
   where brand_id is null and lower(brand) = lower(v_canonical);
  get diagnostics v_linked = row_count;

  select id into v_profile from public.profiles where lower(email) = lower(p_email) limit 1;

  if v_profile is not null then
    insert into public.brand_members (brand_id, user_id, role, status, invited_by)
    values (v_brand_id, v_profile, p_role, 'active', auth.uid())
    on conflict (brand_id, user_id) do update set role = excluded.role, status = 'active';
    v_status := 'active'; v_token := null;
  else
    update public.brand_invites set status = 'revoked'
     where brand_id = v_brand_id and lower(email) = lower(p_email) and status = 'pending';
    insert into public.brand_invites (brand_id, email, role, invited_by)
    values (v_brand_id, lower(p_email), p_role, auth.uid())
    returning token into v_token;
    v_status := 'pending';
  end if;

  return jsonb_build_object(
    'brand_id', v_brand_id, 'slug', v_slug, 'status', v_status,
    'token', v_token, 'logo', v_logo, 'products_linked', v_linked
  );
end;
$$;

grant execute on function public.admin_invite_brand_admin(text, text, text) to authenticated;
