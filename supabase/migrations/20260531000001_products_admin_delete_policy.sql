-- Delete-mode on the consumer feed performs a HARD delete of the product
-- row (app/services/product-creative.ts → deleteProduct). The products
-- table had SELECT / INSERT / UPDATE policies but NO DELETE policy, so
-- with RLS enabled every delete was silently denied (0 rows, no error) —
-- the tile vanished optimistically then reappeared on refresh.
--
-- Add a DELETE policy mirroring the existing "Admins can update products"
-- policy and looks_admin_delete: only admins / super-admins may delete.
-- Every FK referencing products is ON DELETE CASCADE or SET NULL, so the
-- row removal cleans up dependents without constraint errors.

create policy "Admins can delete products"
on public.products
for delete
to public
using (
  exists (
    select 1
    from public.profiles me
    where me.id = auth.uid()
      and (me.is_admin = true or me.role = any (array['admin', 'super_admin']))
  )
);
