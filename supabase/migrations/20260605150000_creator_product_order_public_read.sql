-- Allow anyone to READ a creator's product display order so the public
-- creator catalog can render products in the order the creator chose in
-- "My Catalog". Ordering is non-sensitive (only which products come first,
-- no PII). Writes remain owner-only (insert/update/delete policies from the
-- creator_product_order migration are unchanged).
drop policy if exists "creator_product_order_select_own" on public.creator_product_order;
create policy "creator_product_order_select_public" on public.creator_product_order
  for select using (true);
