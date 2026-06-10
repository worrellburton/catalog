-- Governance type tree — backing store for /admin/governance ("type brain").
--
-- Promotes the product type taxonomy from a flat text column
-- (products.type) + hard-coded regex rules to a real, editable tree.
-- The graph UI reads this table; staged Apply writes tree edits here and
-- cascades renames into products.type (and cross-lane moves into
-- products.gender). Products attach to leaves by name match
-- (lowercased, de-pluralized) — see app/services/type-governance.ts.
--
-- Like `catalogs`, this is an admin-curated registry: RLS stays off and
-- the admin surface is the only writer.

create table if not exists public.product_types (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  parent_id  uuid references public.product_types(id) on delete cascade,
  sort       int  not null default 0,
  -- Lane color for gender nodes (male/female/unisex); descendants inherit
  -- the nearest ancestor color in the UI. Null = neutral.
  color      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- nulls-not-distinct so root-level names are unique too (PG15+).
  unique nulls not distinct (parent_id, name)
);
create index if not exists product_types_parent_idx on public.product_types(parent_id);

comment on table public.product_types is
  'Editable product-type taxonomy (the /admin/governance type brain). parent_id null = first ring under the catalog root.';

-- ── Seed: the founder-specified skeleton + lanes for every type that
--    exists on live products today. Idempotent (on conflict do nothing).

-- Ring 1
insert into public.product_types (name, sort) values
  ('fashion', 1), ('electronics', 2), ('beauty', 3), ('home', 4)
on conflict (parent_id, name) do nothing;

-- Ring 2: gender lanes under fashion (color-coded)
insert into public.product_types (name, parent_id, sort, color)
select v.name, p.id, v.sort, v.color
from (values ('male', 1, '#60a5fa'), ('female', 2, '#f472b6'), ('unisex', 3, '#34d399'))
  as v(name, sort, color)
join public.product_types p on p.name = 'fashion' and p.parent_id is null
on conflict (parent_id, name) do nothing;

-- Ring 3: unisex types (what exists today)
insert into public.product_types (name, parent_id, sort)
select v.name, p.id, v.sort
from (values ('hats', 1), ('tops', 2), ('bottoms', 3), ('shoes', 4), ('accessories', 5),
             ('outerwear', 6), ('loungewear', 7), ('activewear', 8))
  as v(name, sort)
join public.product_types p on p.name = 'unisex'
on conflict (parent_id, name) do nothing;

-- Ring 3: female-only types
insert into public.product_types (name, parent_id, sort)
select 'dresses', p.id, 1 from public.product_types p where p.name = 'female'
on conflict (parent_id, name) do nothing;

-- Ring 4: bottoms → pants / shorts
insert into public.product_types (name, parent_id, sort)
select v.name, p.id, v.sort
from (values ('pants', 1), ('shorts', 2)) as v(name, sort)
join public.product_types p on p.name = 'bottoms'
on conflict (parent_id, name) do nothing;

-- Ring 5: pants → trousers / jeans
insert into public.product_types (name, parent_id, sort)
select v.name, p.id, v.sort
from (values ('trousers', 1), ('jeans', 2)) as v(name, sort)
join public.product_types p on p.name = 'pants'
on conflict (parent_id, name) do nothing;

-- Ring 4: accessories children
insert into public.product_types (name, parent_id, sort)
select v.name, p.id, v.sort
from (values ('belts', 1), ('jewelry', 2), ('eyewear', 3), ('bags', 4)) as v(name, sort)
join public.product_types p on p.name = 'accessories'
on conflict (parent_id, name) do nothing;

insert into public.product_types (name, parent_id, sort)
select 'sunglasses', p.id, 1 from public.product_types p where p.name = 'eyewear'
on conflict (parent_id, name) do nothing;

-- Ring 2: electronics / beauty / home children (live product types)
insert into public.product_types (name, parent_id, sort)
select v.name, p.id, v.sort
from (values ('tech', 1), ('laptops', 2), ('phone cases', 3)) as v(name, sort)
join public.product_types p on p.name = 'electronics' and p.parent_id is null
on conflict (parent_id, name) do nothing;

insert into public.product_types (name, parent_id, sort)
select v.name, p.id, v.sort
from (values ('skincare', 1), ('haircare', 2), ('fragrance', 3)) as v(name, sort)
join public.product_types p on p.name = 'beauty' and p.parent_id is null
on conflict (parent_id, name) do nothing;

insert into public.product_types (name, parent_id, sort)
select v.name, p.id, v.sort
from (values ('decor', 1), ('kitchenware', 2), ('home fragrance', 3), ('stationery', 4))
  as v(name, sort)
join public.product_types p on p.name = 'home' and p.parent_id is null
on conflict (parent_id, name) do nothing;
