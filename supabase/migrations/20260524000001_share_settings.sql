-- Share / link-preview settings for iMessage, Twitter, Slack, etc.
-- Stored as plain key/value rows in app_settings so the admin Sharing page
-- can read/write them through the existing service-role policy.
--
-- Keys this migration owns:
--   share.title         — Open Graph og:title
--   share.description   — Open Graph og:description
--   share.image_url     — Open Graph og:image (absolute URL)
--   share.site_name     — Open Graph og:site_name
--   share.url           — Canonical site URL (og:url default)

insert into public.app_settings (key, value) values
  ('share.title',       'catalog'),
  ('share.description', 'A creator-powered shopping platform where you discover products through curated looks.'),
  ('share.image_url',   ''),
  ('share.site_name',   'catalog'),
  ('share.url',         'https://catalog.shop')
on conflict (key) do nothing;

-- Storage bucket for admin-uploaded OG preview images. Public so iMessage,
-- Twitter, Slack, etc. bots can fetch the image without a signed URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'share-images',
  'share-images',
  true,
  5242880, -- 5 MB / file
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Anyone can read share-image objects (bots are unauthenticated).
drop policy if exists share_images_read on storage.objects;
create policy share_images_read on storage.objects for select
  using (bucket_id = 'share-images');

-- Authenticated admins (or any signed-in user — admin gate is enforced
-- client-side at /admin) can upload. The app_settings write itself is
-- still gated by the service-role policy, so a hostile authenticated
-- user can only orphan files in the bucket, not change the live OG tags.
drop policy if exists share_images_insert on storage.objects;
create policy share_images_insert on storage.objects for insert
  with check (bucket_id = 'share-images' and auth.uid() is not null);

drop policy if exists share_images_update on storage.objects;
create policy share_images_update on storage.objects for update
  using (bucket_id = 'share-images' and auth.uid() is not null);

drop policy if exists share_images_delete on storage.objects;
create policy share_images_delete on storage.objects for delete
  using (bucket_id = 'share-images' and auth.uid() is not null);

-- Open the admin-write policy on app_settings to include the share.* keys.
-- The existing service_role policy already covers this, but the prompts
-- migration (20260509000001_style_feature) added an admin_write policy
-- scoped to specific keys. Extend it to cover share.* as well.
drop policy if exists app_settings_share_write on public.app_settings;
create policy app_settings_share_write on public.app_settings
  for all
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    and key like 'share.%'
  )
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    and key like 'share.%'
  );
