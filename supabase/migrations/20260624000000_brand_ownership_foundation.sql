-- Brand ownership foundation (Phase 1 of the Shopify brand portal).
--
-- Adds the multi-tenant primitives the new brand admin panel needs:
--   * brands            — a real brand entity (the free-text products.brand becomes a mirror)
--   * brand_members     — team membership + role (one row per brand+user; a user may join >1 brand)
--   * products.brand_id — owner FK (nullable: platform-curated rows stay null)
--   * is_platform_admin() / is_brand_member() — the single RLS seam (see note below)
--
-- Authored against auth.uid() because the LIVE data layer is Supabase Auth
-- (Clerk is wired only at the entry gate and is NOT bridged to the DB yet:
-- profiles has no clerk_user_id and no policy references clerk). When the Clerk
-- data-layer bridge lands and swaps auth.uid()->app_uid() repo-wide, it flips
-- these two helper functions in ONE place. Do not author a parallel Clerk world.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.brands (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,              -- url-safe, e.g. 'aritzia'
  name            text not null,
  canonical_brand text,                              -- matches products.brand string for backfill/join
  logo_url        text,
  shopify_shop    text,                              -- <store>.myshopify.com, null until connected
  stripe_customer_id text,
  subscription_status text,                          -- null/active/past_due; thin, expand in Phase 4
  created_at      timestamptz not null default now()
);

create table if not exists public.brand_members (
  brand_id   uuid not null references public.brands(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'creative'
             check (role in ('owner','admin','finance','creative')),
  status     text not null default 'active'
             check (status in ('invited','active','removed')),
  invited_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (brand_id, user_id)
);
create index if not exists brand_members_user_idx on public.brand_members(user_id);

-- products gains a nullable owner FK; platform-curated rows keep brand_id null.
alter table public.products add column if not exists brand_id uuid references public.brands(id);
create index if not exists products_brand_id_idx on public.products(brand_id);

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER → read profiles/brand_members without
-- recursing through their own RLS). These are the ONLY place auth.uid() is
-- read for brand authorization, so the future Clerk swap is a one-liner.
-- ---------------------------------------------------------------------------

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles me
    where me.id = auth.uid()
      and (me.is_admin = true or me.role in ('admin','super_admin'))
  );
$$;

create or replace function public.is_brand_member(b uuid, min_role text default 'creative')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.brand_members m
    where m.brand_id = b
      and m.user_id = auth.uid()
      and m.status = 'active'
      and case min_role
            when 'owner'   then m.role = 'owner'
            when 'admin'   then m.role in ('owner','admin')
            when 'finance' then m.role in ('owner','admin','finance')
            else true                              -- 'creative' = any active member
          end
  );
$$;

grant execute on function public.is_platform_admin() to anon, authenticated;
grant execute on function public.is_brand_member(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS: brands
-- ---------------------------------------------------------------------------

alter table public.brands enable row level security;

drop policy if exists brands_read on public.brands;
create policy brands_read on public.brands for select
  using (public.is_brand_member(id) or public.is_platform_admin());

drop policy if exists brands_insert on public.brands;
create policy brands_insert on public.brands for insert
  with check (public.is_platform_admin());          -- v1: brands provisioned by admin/service-role

drop policy if exists brands_update on public.brands;
create policy brands_update on public.brands for update
  using (public.is_brand_member(id,'admin') or public.is_platform_admin())
  with check (public.is_brand_member(id,'admin') or public.is_platform_admin());

drop policy if exists brands_delete on public.brands;
create policy brands_delete on public.brands for delete
  using (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- RLS: brand_members
-- ---------------------------------------------------------------------------

alter table public.brand_members enable row level security;

drop policy if exists members_read on public.brand_members;
create policy members_read on public.brand_members for select
  using (public.is_brand_member(brand_id) or public.is_platform_admin());

-- owner/admin of the brand (or a platform admin) manage the team.
-- INSERT only checks with_check; the first owner row is seeded by admin/service-role.
drop policy if exists members_write on public.brand_members;
create policy members_write on public.brand_members for all
  using (public.is_brand_member(brand_id,'admin') or public.is_platform_admin())
  with check (public.is_brand_member(brand_id,'admin') or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- RLS: products — close the open INSERT hole
--
-- Old policy was `INSERT WITH CHECK (true)` → ANY authenticated user could
-- insert. Audited every insert path: the 5 client-side ones (affiliate import,
-- catalog ingest, google-shopping drill, brand-url add, manual entry) are all
-- admin-only UIs → keep working via is_platform_admin(). lens-ingest + the
-- future shopify-sync write with the service role (bypass RLS). UPDATE/DELETE
-- are already admin-only and are left unchanged.
-- ---------------------------------------------------------------------------

drop policy if exists "Authenticated users can insert products" on public.products;
drop policy if exists products_insert on public.products;
create policy products_insert on public.products for insert
  with check (public.is_platform_admin());
-- ponytail: admin-only INSERT for v1. Add an `or (brand_id is not null and
-- is_brand_member(brand_id,'creative'))` branch here when brands create
-- products directly (full-parity phase); shopify-sync stays service-role.
