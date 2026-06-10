-- Per-creator display order for the products that appear across their looks.
-- Drives the "Products" tab in My Catalog (drag-to-reorder). Absence of a
-- row just means "unordered" — the service falls back to a stable default.
create table if not exists public.creator_product_order (
  user_id    uuid    not null references auth.users(id) on delete cascade,
  product_id uuid    not null references public.products(id) on delete cascade,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

alter table public.creator_product_order enable row level security;

-- Owner-only: a creator can only see and reorder their own product order.
create policy "creator_product_order_select_own" on public.creator_product_order
  for select using (auth.uid() = user_id);
create policy "creator_product_order_insert_own" on public.creator_product_order
  for insert with check (auth.uid() = user_id);
create policy "creator_product_order_update_own" on public.creator_product_order
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "creator_product_order_delete_own" on public.creator_product_order
  for delete using (auth.uid() = user_id);

create index if not exists idx_creator_product_order_user
  on public.creator_product_order(user_id, sort_order);
