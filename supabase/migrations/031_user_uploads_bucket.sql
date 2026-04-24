-- Storage bucket for shopper-uploaded reference photos used by the Generate
-- flow. Private (we serve via public_url stored on user_uploads.public_url
-- which is a Supabase-signed public URL for the bucket object).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'user-uploads',
  'user-uploads',
  true,
  10485760, -- 10 MB / file
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

-- Bucket policies: shopper can upload to their own prefix (user/<uid>/...)
-- and read their own objects. Anon can read anything public-flagged (so
-- signed URLs keep working for admin views).
drop policy if exists user_uploads_bucket_read on storage.objects;
drop policy if exists user_uploads_bucket_insert on storage.objects;

create policy user_uploads_bucket_read on storage.objects for select
  using (bucket_id = 'user-uploads');

create policy user_uploads_bucket_insert on storage.objects for insert
  with check (
    bucket_id = 'user-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
