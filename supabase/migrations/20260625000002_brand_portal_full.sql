-- Full partner-portal parity: the data layer for the remaining old pages
-- (orders, collections, ads, audiences, campaigns, company, billing). Every
-- table is brand-scoped; RLS reuses is_brand_member()/is_platform_admin().
-- Members read their brand's rows; owner/admin (or any active member, for
-- content tables) write. Billing/company are admin-scoped.

-- ---------------------------------------------------------------------------
-- Company details + storefront background live on brands.
-- ---------------------------------------------------------------------------
alter table public.brands add column if not exists company_legal_name text;
alter table public.brands add column if not exists company_email text;
alter table public.brands add column if not exists company_phone text;
alter table public.brands add column if not exists company_address text;
alter table public.brands add column if not exists background_url text;

-- ---------------------------------------------------------------------------
-- Brand members may edit their OWN brand's products (old portal behavior).
-- Additive to the existing admin-only update policy.
-- ---------------------------------------------------------------------------
drop policy if exists products_update_brand on public.products;
create policy products_update_brand on public.products for update
  using (brand_id is not null and public.is_brand_member(brand_id))
  with check (brand_id is not null and public.is_brand_member(brand_id));

-- Helper: any active member of the brand (content tables) ----------------
-- (is_brand_member already defaults to 'creative' = any active member.)

-- ---------------------------------------------------------------------------
-- Collections
-- ---------------------------------------------------------------------------
create table if not exists public.brand_collections (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references public.brands(id) on delete cascade,
  name       text not null,
  slug       text,
  created_at timestamptz not null default now()
);
create index if not exists brand_collections_brand_idx on public.brand_collections(brand_id);

create table if not exists public.brand_collection_products (
  collection_id uuid not null references public.brand_collections(id) on delete cascade,
  product_id    uuid not null references public.products(id) on delete cascade,
  sort_order    int not null default 0,
  primary key (collection_id, product_id)
);

-- ---------------------------------------------------------------------------
-- Orders (revenue feed — populated by Shopify order webhooks later)
-- ---------------------------------------------------------------------------
create table if not exists public.brand_orders (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid not null references public.brands(id) on delete cascade,
  order_number   text,
  customer_name  text,
  customer_email text,
  total          numeric default 0,
  currency       text default 'USD',
  status         text default 'paid',
  placed_at      timestamptz default now(),
  created_at     timestamptz not null default now()
);
create index if not exists brand_orders_brand_idx on public.brand_orders(brand_id, placed_at desc);

-- ---------------------------------------------------------------------------
-- Audiences (gender + age + optional creator follows)
-- ---------------------------------------------------------------------------
create table if not exists public.brand_audiences (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references public.brands(id) on delete cascade,
  name       text not null,
  gender     text,                              -- 'all' | 'male' | 'female'
  age_min    int default 18,
  age_max    int default 65,
  follows    jsonb default '[]'::jsonb,          -- creator handles
  created_at timestamptz not null default now()
);
create index if not exists brand_audiences_brand_idx on public.brand_audiences(brand_id);

-- ---------------------------------------------------------------------------
-- Advertisements (creative + heading/CTA/orientation + status)
-- ---------------------------------------------------------------------------
create table if not exists public.brand_advertisements (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.brands(id) on delete cascade,
  name        text not null,
  media_url   text,
  media_type  text default 'image',             -- 'image' | 'video'
  heading     text,
  cta         text,
  orientation text default 'portrait',           -- 'portrait' | 'landscape'
  status      text not null default 'draft',     -- draft | active | paused
  created_at  timestamptz not null default now()
);
create index if not exists brand_ads_brand_idx on public.brand_advertisements(brand_id);

-- ---------------------------------------------------------------------------
-- Campaigns (ad + audience + destination + daily budget + status)
-- ---------------------------------------------------------------------------
create table if not exists public.brand_campaigns (
  id               uuid primary key default gen_random_uuid(),
  brand_id         uuid not null references public.brands(id) on delete cascade,
  name             text not null,
  advertisement_id uuid references public.brand_advertisements(id) on delete set null,
  audience_id      uuid references public.brand_audiences(id) on delete set null,
  destination_url  text,
  daily_budget     numeric default 0,
  status           text not null default 'draft', -- draft | active | paused | ended
  starts_at        timestamptz,
  ends_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists brand_campaigns_brand_idx on public.brand_campaigns(brand_id);

-- ---------------------------------------------------------------------------
-- Billing: plan catalog (seeded) + per-brand subscription + invoices
-- ---------------------------------------------------------------------------
create table if not exists public.brand_plans (
  id            text primary key,
  name          text not null,
  price_monthly numeric not null default 0,
  features      jsonb default '[]'::jsonb,
  sort_order    int default 0,
  active        boolean not null default true
);

create table if not exists public.brand_subscriptions (
  brand_id           uuid primary key references public.brands(id) on delete cascade,
  plan_id            text references public.brand_plans(id),
  status             text not null default 'inactive', -- inactive | active | past_due | canceled
  current_period_end timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.brand_invoices (
  id        uuid primary key default gen_random_uuid(),
  brand_id  uuid not null references public.brands(id) on delete cascade,
  number    text,
  amount    numeric not null default 0,
  currency  text default 'USD',
  status    text default 'paid',                 -- paid | open | void
  issued_at timestamptz not null default now(),
  pdf_url   text
);
create index if not exists brand_invoices_brand_idx on public.brand_invoices(brand_id, issued_at desc);

insert into public.brand_plans (id, name, price_monthly, features, sort_order) values
  ('starter', 'Starter', 0,   '["Up to 50 products","Basic analytics","1 campaign"]'::jsonb, 1),
  ('growth',  'Growth',  99,  '["Unlimited products","Full analytics","10 campaigns","AI creatives"]'::jsonb, 2),
  ('pro',     'Pro',     299, '["Everything in Growth","Priority support","Unlimited campaigns","Dedicated manager"]'::jsonb, 3)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.brand_collections          enable row level security;
alter table public.brand_collection_products  enable row level security;
alter table public.brand_orders               enable row level security;
alter table public.brand_audiences            enable row level security;
alter table public.brand_advertisements       enable row level security;
alter table public.brand_campaigns            enable row level security;
alter table public.brand_plans                enable row level security;
alter table public.brand_subscriptions        enable row level security;
alter table public.brand_invoices             enable row level security;

-- Content tables: members read + write their brand's rows.
do $$
declare t text;
begin
  foreach t in array array['brand_collections','brand_audiences','brand_advertisements','brand_campaigns'] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select using (public.is_brand_member(brand_id) or public.is_platform_admin())', t);
    execute format('drop policy if exists %1$s_write on public.%1$s', t);
    execute format('create policy %1$s_write on public.%1$s for all using (public.is_brand_member(brand_id) or public.is_platform_admin()) with check (public.is_brand_member(brand_id) or public.is_platform_admin())', t);
  end loop;
end $$;

-- Collection-products: scoped through the parent collection's brand.
drop policy if exists bcp_read on public.brand_collection_products;
create policy bcp_read on public.brand_collection_products for select
  using (exists (select 1 from public.brand_collections c where c.id = collection_id and (public.is_brand_member(c.brand_id) or public.is_platform_admin())));
drop policy if exists bcp_write on public.brand_collection_products;
create policy bcp_write on public.brand_collection_products for all
  using (exists (select 1 from public.brand_collections c where c.id = collection_id and (public.is_brand_member(c.brand_id) or public.is_platform_admin())))
  with check (exists (select 1 from public.brand_collections c where c.id = collection_id and (public.is_brand_member(c.brand_id) or public.is_platform_admin())));

-- Read-only-for-members tables (orders, subscription, invoices): read = member,
-- write = platform admin / service role (data arrives from webhooks/billing).
do $$
declare t text;
begin
  foreach t in array array['brand_orders','brand_subscriptions','brand_invoices'] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select using (public.is_brand_member(brand_id) or public.is_platform_admin())', t);
    execute format('drop policy if exists %1$s_admin_write on public.%1$s', t);
    execute format('create policy %1$s_admin_write on public.%1$s for all using (public.is_platform_admin()) with check (public.is_platform_admin())', t);
  end loop;
end $$;

-- Subscriptions: a brand owner/admin may set their own plan (the "subscribe"
-- action; real payment is wired later, this just records the chosen plan).
drop policy if exists brand_subscriptions_self on public.brand_subscriptions;
create policy brand_subscriptions_self on public.brand_subscriptions for all
  using (public.is_brand_member(brand_id, 'admin') or public.is_platform_admin())
  with check (public.is_brand_member(brand_id, 'admin') or public.is_platform_admin());

-- Plans: any authenticated user reads the catalog; admin writes.
drop policy if exists brand_plans_read on public.brand_plans;
create policy brand_plans_read on public.brand_plans for select using (true);
drop policy if exists brand_plans_admin on public.brand_plans;
create policy brand_plans_admin on public.brand_plans for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());
