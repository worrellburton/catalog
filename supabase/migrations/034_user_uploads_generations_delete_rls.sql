-- Allow shoppers to delete their own reference uploads and generation
-- rows from the Generate page. The pivot tables already have
-- `for all` policies keyed off the parent generation, so cascading
-- deletes go through cleanly.

drop policy if exists user_uploads_self_delete on public.user_uploads;
create policy user_uploads_self_delete on public.user_uploads for delete
  using (auth.uid() = user_id);

drop policy if exists user_generations_self_delete on public.user_generations;
create policy user_generations_self_delete on public.user_generations for delete
  using (auth.uid() = user_id);

-- Storage: shopper can delete their own objects under their uid prefix.
drop policy if exists user_uploads_bucket_delete on storage.objects;
create policy user_uploads_bucket_delete on storage.objects for delete
  using (
    bucket_id = 'user-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
