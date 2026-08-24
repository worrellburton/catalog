-- Phase 2 foundation: human stylists + showroom + become-a-stylist applications.
--
-- Extends style_up_stylists (currently AI personas only) with the fields a
-- human stylist needs, and adds two new tables — a stylist-curated product
-- showroom and an application queue for shoppers who want to become stylists.

-- ── 1. style_up_stylists: human-stylist columns ────────────────────────────
alter table public.style_up_stylists
  add column if not exists is_human boolean not null default false,
  add column if not exists human_user_id uuid references auth.users(id) on delete set null,
  add column if not exists gender_focus text check (gender_focus in ('men','women','unisex')),
  add column if not exists accepting_new boolean not null default true;

-- One auth user maps to at most one human-stylist row.
create unique index if not exists style_up_stylists_human_user_id_key
  on public.style_up_stylists (human_user_id)
  where human_user_id is not null;

-- Sort/filter humans-vs-AI cheaply in the picker.
create index if not exists style_up_stylists_is_human_idx
  on public.style_up_stylists (is_human);

-- ── 2. stylist_showroom_products: stylist's curated picks ─────────────────
create table if not exists public.stylist_showroom_products (
  stylist_id uuid not null references public.style_up_stylists(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  gender text not null check (gender in ('men','women','unisex')),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (stylist_id, product_id, gender)
);

create index if not exists stylist_showroom_stylist_gender_idx
  on public.stylist_showroom_products (stylist_id, gender, sort);

alter table public.stylist_showroom_products enable row level security;

-- Public read (the showroom is a shoppable surface).
drop policy if exists stylist_showroom_products_select on public.stylist_showroom_products;
create policy stylist_showroom_products_select
  on public.stylist_showroom_products
  for select
  to anon, authenticated
  using (true);

-- Writes: the stylist themselves (via their linked auth user) can add/remove
-- from their own showroom. Admins go through the service-role key and bypass.
drop policy if exists stylist_showroom_products_write on public.stylist_showroom_products;
create policy stylist_showroom_products_write
  on public.stylist_showroom_products
  for all
  to authenticated
  using (
    exists (
      select 1 from public.style_up_stylists s
      where s.id = stylist_id and s.human_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.style_up_stylists s
      where s.id = stylist_id and s.human_user_id = auth.uid()
    )
  );

-- ── 3. stylist_applications: shopper → become-a-stylist queue ─────────────
create table if not exists public.stylist_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  bio text,
  sample_url text,
  gender_focus text check (gender_focus in ('men','women','unisex')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_notes text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);

-- One open (pending) application per user; historical rows kept.
create unique index if not exists stylist_applications_one_pending_per_user
  on public.stylist_applications (user_id)
  where status = 'pending';

create index if not exists stylist_applications_status_created_idx
  on public.stylist_applications (status, created_at desc);

alter table public.stylist_applications enable row level security;

-- Applicants see only their own rows.
drop policy if exists stylist_applications_select_own on public.stylist_applications;
create policy stylist_applications_select_own
  on public.stylist_applications
  for select
  to authenticated
  using (user_id = auth.uid());

-- Applicants insert only rows for themselves; status defaults to 'pending'.
drop policy if exists stylist_applications_insert_own on public.stylist_applications;
create policy stylist_applications_insert_own
  on public.stylist_applications
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- Admin updates (approve/reject) go through the service-role key.
