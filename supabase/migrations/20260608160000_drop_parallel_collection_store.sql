-- Corrective: the product-menu "Add to collection" now routes through the
-- pre-existing creator_collections system (product_keys, authored via the
-- saved-layout store and shown on the public catalog). The parallel
-- creator_collection_products table added in 20260608150000 is unused, and
-- the redundant creator_collections policies that migration added are dropped
-- so the table's original RLS stands unchanged.

drop table if exists public.creator_collection_products;
drop policy if exists creator_collections_owner on public.creator_collections;
drop policy if exists creator_collections_read on public.creator_collections;
