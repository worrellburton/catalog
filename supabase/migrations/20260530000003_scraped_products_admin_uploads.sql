-- Lets the admin Data → Products → Photos panel upload photos
-- straight from the browser. Previously only service_role could INSERT
-- into scraped-products, so drag-and-drop uploads hit a 403 RLS error.
-- Restricted to authenticated admins.

drop policy if exists "scraped_products_admin_insert" on storage.objects;
drop policy if exists "scraped_products_admin_update" on storage.objects;
drop policy if exists "scraped_products_admin_delete" on storage.objects;

create policy "scraped_products_admin_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'scraped-products'
  and exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and (profiles.is_admin = true or profiles.role in ('admin', 'super_admin'))
  )
);

create policy "scraped_products_admin_update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'scraped-products'
  and exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and (profiles.is_admin = true or profiles.role in ('admin', 'super_admin'))
  )
)
with check (
  bucket_id = 'scraped-products'
  and exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and (profiles.is_admin = true or profiles.role in ('admin', 'super_admin'))
  )
);

create policy "scraped_products_admin_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'scraped-products'
  and exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and (profiles.is_admin = true or profiles.role in ('admin', 'super_admin'))
  )
);
