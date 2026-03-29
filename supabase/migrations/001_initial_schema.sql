-- Catalog Initial Schema
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New Query)

-- Enable pgvector for future semantic search
create extension if not exists vector with schema extensions;

-- ============================================
-- CREATORS
-- ============================================
create table if not exists creators (
  id uuid primary key default gen_random_uuid(),
  handle text unique not null,          -- e.g. '@lilywittman'
  display_name text not null,
  avatar_url text,
  bio text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================
-- PRODUCTS
-- ============================================
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand text,
  price text,                           -- kept as text to match display format ('$568')
  url text,
  image_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================
-- LOOKS
-- ============================================
create table if not exists looks (
  id uuid primary key default gen_random_uuid(),
  legacy_id integer unique,             -- maps to the old integer id
  title text not null,
  video_path text not null,             -- e.g. 'girl2.mp4'
  gender text check (gender in ('men', 'women')),
  creator_handle text not null references creators(handle),
  description text,
  color text,                           -- hex color for fallback UI
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================
-- LOOK ↔ PRODUCT (junction table)
-- ============================================
create table if not exists look_products (
  id uuid primary key default gen_random_uuid(),
  look_id uuid not null references looks(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  sort_order integer default 0,
  unique(look_id, product_id)
);

-- ============================================
-- SEARCH SUGGESTIONS
-- ============================================
create table if not exists search_suggestions (
  id uuid primary key default gen_random_uuid(),
  text text unique not null,
  sort_order integer default 0
);

-- ============================================
-- INDEXES
-- ============================================
create index if not exists idx_looks_creator on looks(creator_handle);
create index if not exists idx_looks_gender on looks(gender);
create index if not exists idx_look_products_look on look_products(look_id);
create index if not exists idx_look_products_product on look_products(product_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
-- Enable RLS on all tables
alter table creators enable row level security;
alter table products enable row level security;
alter table looks enable row level security;
alter table look_products enable row level security;
alter table search_suggestions enable row level security;

-- Public read access (anon key can read, no write)
create policy "Public read creators" on creators for select using (true);
create policy "Public read products" on products for select using (true);
create policy "Public read looks" on looks for select using (true);
create policy "Public read look_products" on look_products for select using (true);
create policy "Public read search_suggestions" on search_suggestions for select using (true);

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_creators_updated before update on creators
  for each row execute function update_updated_at();
create trigger trg_products_updated before update on products
  for each row execute function update_updated_at();
create trigger trg_looks_updated before update on looks
  for each row execute function update_updated_at();
