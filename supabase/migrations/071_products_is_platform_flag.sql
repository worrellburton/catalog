-- Platform visibility flag for products. Sister to is_active (which
-- governs the home grid). When is_platform=false, the product is
-- excluded from search results and from any catalog-wide listing,
-- but stays in the admin Content table so an admin can flip it back
-- on. Default true so existing inventory keeps surfacing through
-- search after the migration lands.
alter table products
  add column if not exists is_platform boolean not null default true;

-- Index on the flag so search-side queries can filter cheaply once
-- the catalog grows. Partial index (the false rows are the rare
-- exception) keeps the index size minimal.
create index if not exists products_is_platform_idx
  on products (is_platform) where is_platform = false;
