-- 051b: Add gender and type columns to products
--
-- Required by the semantic search RPCs (052) for gender/type filtering.
-- Also used by embed-entity (for concept_doc input) and product-search (ingest).

alter table public.products
  add column if not exists gender text check (gender in ('men', 'women', 'unisex')),
  add column if not exists type   text;

create index if not exists idx_products_gender on public.products(gender) where gender is not null;
create index if not exists idx_products_type   on public.products(type)   where type   is not null;
