-- Migration 089: Add description_enriched flag to track AI enrichment status
--
-- PURPOSE:
--   Track which products have had their descriptions enriched with AI-generated
--   contextual content (occasions, activities, price context).
--
-- USAGE:
--   - Set to TRUE after successful enrichment
--   - Allows incremental backfill (skip already enriched products)
--   - Can re-enrich by setting to FALSE

alter table public.products
add column if not exists description_enriched boolean default false;

comment on column public.products.description_enriched is 
  'TRUE if description has been enriched with AI-generated contextual content (occasions, activities, price context)';

-- Create index for filtering during backfill
create index if not exists idx_products_description_enriched 
  on public.products (description_enriched) 
  where description_enriched = false;
