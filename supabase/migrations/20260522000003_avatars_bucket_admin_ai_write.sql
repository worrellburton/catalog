-- Avatars bucket: admins can write/update/delete any AI persona's
-- avatar folder so the inline AvatarUpload on /admin/user/<id> can
-- swap profile pictures for personas. Mirrors the impersonation gate
-- on user-uploads (admin AND target is_ai=true), so admins still
-- can't touch a real user's avatar through this path.

drop policy if exists avatars_admin_ai_insert on storage.objects;
create policy avatars_admin_ai_insert on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    and exists (
      select 1 from public.profiles
      where id::text = (storage.foldername(name))[1] and is_ai = true
    )
  );

drop policy if exists avatars_admin_ai_update on storage.objects;
create policy avatars_admin_ai_update on storage.objects for update
  using (
    bucket_id = 'avatars'
    and exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    and exists (
      select 1 from public.profiles
      where id::text = (storage.foldername(name))[1] and is_ai = true
    )
  )
  with check (
    bucket_id = 'avatars'
    and exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    and exists (
      select 1 from public.profiles
      where id::text = (storage.foldername(name))[1] and is_ai = true
    )
  );

drop policy if exists avatars_admin_ai_delete on storage.objects;
create policy avatars_admin_ai_delete on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    and exists (
      select 1 from public.profiles
      where id::text = (storage.foldername(name))[1] and is_ai = true
    )
  );
