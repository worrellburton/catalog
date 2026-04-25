-- Add a single-value `type` column for products. The existing
-- `catalog_tags` jsonb stays for fine-grained tag flags (Color/Material
-- /Brand etc.) -- `type` is the one-line "what is it" the admin Content
-- table renders as a column and the consumer feed can group by.

alter table public.products
  add column if not exists type text;

create index if not exists products_type_idx on public.products (type);

comment on column public.products.type is
  'Single-word product type (Hat, Top, Dress, Shoes, Book, Bag, etc.). Inferred from name on insert; audit button on /admin/content backfills.';
