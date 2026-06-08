-- Creator catalog product management: per-product active/inactive + collections.
--
-- The My Catalog "Products" tab aggregates every product across a creator's
-- looks. Until now the only per-product action was drag-reorder
-- (creator_product_order). This adds:
--   1. creator_hidden_products  — presence = the creator marked the product
--      INACTIVE (hidden from their public catalog).
--   2. creator_collections      — named, ordered product collections.
--   3. creator_collection_products — products in each collection.
-- All owner-managed via RLS, public-readable so the choices show on the
-- public creator catalog too.

-- ── 1. Active / inactive ──────────────────────────────────────────────
create table if not exists public.creator_hidden_products (
  user_id    uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
alter table public.creator_hidden_products enable row level security;
drop policy if exists creator_hidden_products_owner on public.creator_hidden_products;
create policy creator_hidden_products_owner on public.creator_hidden_products
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists creator_hidden_products_read on public.creator_hidden_products;
create policy creator_hidden_products_read on public.creator_hidden_products
  for select using (true);

-- ── 2. Collections ────────────────────────────────────────────────────
create table if not exists public.creator_collections (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);
alter table public.creator_collections enable row level security;
drop policy if exists creator_collections_owner on public.creator_collections;
create policy creator_collections_owner on public.creator_collections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists creator_collections_read on public.creator_collections;
create policy creator_collections_read on public.creator_collections
  for select using (true);
create index if not exists creator_collections_user_idx on public.creator_collections(user_id);

-- ── 3. Collection ↔ product ───────────────────────────────────────────
create table if not exists public.creator_collection_products (
  collection_id uuid not null references public.creator_collections(id) on delete cascade,
  product_id    uuid not null references public.products(id) on delete cascade,
  sort_order    int  not null default 0,
  created_at    timestamptz not null default now(),
  primary key (collection_id, product_id)
);
alter table public.creator_collection_products enable row level security;
drop policy if exists ccp_owner on public.creator_collection_products;
create policy ccp_owner on public.creator_collection_products
  for all using (
    exists (select 1 from public.creator_collections c where c.id = collection_id and c.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.creator_collections c where c.id = collection_id and c.user_id = auth.uid())
  );
drop policy if exists ccp_read on public.creator_collection_products;
create policy ccp_read on public.creator_collection_products
  for select using (true);
