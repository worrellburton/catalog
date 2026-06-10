-- The share-images bucket holds the OG preview images shown when
-- someone shares a catalog URL in iMessage / Slack / etc. The
-- original policies (20260524000001_share_settings) let any
-- authenticated user write — a registered shopper could orphan
-- objects there or burn quota by uploading garbage. Narrow writes
-- to admins (matches app_settings_share_write on the same flow).

drop policy if exists share_images_insert on storage.objects;
create policy share_images_insert on storage.objects for insert
  with check (
    bucket_id = 'share-images'
    and exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

drop policy if exists share_images_update on storage.objects;
create policy share_images_update on storage.objects for update
  using (
    bucket_id = 'share-images'
    and exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

drop policy if exists share_images_delete on storage.objects;
create policy share_images_delete on storage.objects for delete
  using (
    bucket_id = 'share-images'
    and exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );
