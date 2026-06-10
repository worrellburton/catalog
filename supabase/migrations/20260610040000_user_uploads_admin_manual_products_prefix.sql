-- Admin "Add Manually" product images upload to user-uploads under the
-- manual-products/ prefix (services/manual-product.ts → uploadProductImage),
-- but the bucket's insert policies only allowed <auth.uid()>/… own-prefix
-- uploads (031) and admin→AI-persona prefixes (20260521020000). Every manual
-- product image therefore failed with "new row violates row-level security
-- policy". Allow signed-in admins to write (and clean up) that prefix.

drop policy if exists user_uploads_bucket_manual_products_insert on storage.objects;
create policy user_uploads_bucket_manual_products_insert on storage.objects for insert
  with check (
    bucket_id = 'user-uploads'
    and (storage.foldername(name))[1] = 'manual-products'
    and exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

drop policy if exists user_uploads_bucket_manual_products_delete on storage.objects;
create policy user_uploads_bucket_manual_products_delete on storage.objects for delete
  using (
    bucket_id = 'user-uploads'
    and (storage.foldername(name))[1] = 'manual-products'
    and exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );
