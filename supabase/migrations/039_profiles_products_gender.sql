-- Auto-detected gender on profiles + on products. Both columns are
-- text with a check constraint so a stale client can't write garbage.
--
-- profiles.gender: 'male' | 'female' | 'unknown'  (default 'unknown')
--   Inferred from full_name on the admin users page; downstream the
--   /generate flow filters product picks by the shopper's gender.
--
-- products.gender: 'male' | 'female' | 'unisex' | null
--   null means "not yet inferred"; unisex stays visible to anyone.
--   Inferred from product.name ("women's", "men's", "ladies", etc.)
--   on a Type-audit-style backfill button.

alter table public.profiles
  add column if not exists gender text not null default 'unknown';

alter table public.profiles
  drop constraint if exists profiles_gender_check;
alter table public.profiles
  add constraint profiles_gender_check
  check (gender in ('male', 'female', 'unknown'));

create index if not exists profiles_gender_idx on public.profiles (gender);

alter table public.products
  add column if not exists gender text;

alter table public.products
  drop constraint if exists products_gender_check;
alter table public.products
  add constraint products_gender_check
  check (gender is null or gender in ('male', 'female', 'unisex'));

create index if not exists products_gender_idx on public.products (gender);

comment on column public.profiles.gender is
  'Inferred from full_name on the admin users page. Used as the consumer-side product filter so a male shopper sees male+unisex products in /generate.';
comment on column public.products.gender is
  'Inferred from product name. null = not inferred; unisex stays visible to all genders.';
