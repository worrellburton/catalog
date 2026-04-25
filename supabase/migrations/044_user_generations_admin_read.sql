-- Admins need to read every shopper's reference photos and generated
-- looks from /admin/user/<id>. The original 030 RLS only allows
-- `auth.uid() = user_id`, so when an admin opens another user's
-- profile their session sees zero rows and the page silently shows
-- "Generated looks (0)" / "Reference photos (0)" even when the data
-- exists. We add admin-read policies gated on profiles.is_admin
-- (the canonical admin flag from 037, same pattern as 042).

drop policy if exists user_uploads_admin_read on public.user_uploads;
create policy user_uploads_admin_read on public.user_uploads for select
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

drop policy if exists user_generations_admin_read on public.user_generations;
create policy user_generations_admin_read on public.user_generations for select
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

drop policy if exists user_generation_uploads_admin_read on public.user_generation_uploads;
create policy user_generation_uploads_admin_read on public.user_generation_uploads for select
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

drop policy if exists user_generation_products_admin_read on public.user_generation_products;
create policy user_generation_products_admin_read on public.user_generation_products for select
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );
