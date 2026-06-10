-- Admin impersonation of AI personas in the /generate wizard.
--
-- An admin can land on /generate?as_user=<id> and run the wizard "as"
-- an AI persona (profiles.is_ai = true). The resulting user_generations
-- row (plus uploads / slots / pivot rows) attach to the persona, not
-- the admin's own profile. These policies mirror the self_* ones but
-- gate on the current session being is_admin AND the target user being
-- is_ai — so we don't grant blanket cross-shopper write to admins.
--
-- Scope: insert + update + delete on user_uploads, user_generations,
-- user_generation_uploads, user_generation_products, user_generation_slots,
-- and the user-uploads storage bucket.

-- ============================================================
-- user_uploads
-- ============================================================
drop policy if exists user_uploads_admin_write on public.user_uploads;
create policy user_uploads_admin_write on public.user_uploads for insert
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    and exists (select 1 from public.profiles where id = user_uploads.user_id and is_ai = true)
  );

drop policy if exists user_uploads_admin_delete on public.user_uploads;
create policy user_uploads_admin_delete on public.user_uploads for delete
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    and exists (select 1 from public.profiles where id = user_uploads.user_id and is_ai = true)
  );

-- ============================================================
-- user_generations
-- ============================================================
drop policy if exists user_generations_admin_write on public.user_generations;
create policy user_generations_admin_write on public.user_generations for insert
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    and exists (select 1 from public.profiles where id = user_generations.user_id and is_ai = true)
  );

drop policy if exists user_generations_admin_update on public.user_generations;
create policy user_generations_admin_update on public.user_generations for update
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    and exists (select 1 from public.profiles where id = user_generations.user_id and is_ai = true)
  )
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    and exists (select 1 from public.profiles where id = user_generations.user_id and is_ai = true)
  );

drop policy if exists user_generations_admin_delete on public.user_generations;
create policy user_generations_admin_delete on public.user_generations for delete
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    and exists (select 1 from public.profiles where id = user_generations.user_id and is_ai = true)
  );

-- ============================================================
-- user_generation_uploads (pivot)
-- ============================================================
drop policy if exists user_generation_uploads_admin on public.user_generation_uploads;
create policy user_generation_uploads_admin on public.user_generation_uploads for all
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    and exists (
      select 1 from public.user_generations g
      join public.profiles tp on tp.id = g.user_id
      where g.id = user_generation_uploads.generation_id and tp.is_ai = true
    )
  )
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    and exists (
      select 1 from public.user_generations g
      join public.profiles tp on tp.id = g.user_id
      where g.id = user_generation_uploads.generation_id and tp.is_ai = true
    )
  );

-- ============================================================
-- user_generation_products (pivot)
-- ============================================================
drop policy if exists user_generation_products_admin on public.user_generation_products;
create policy user_generation_products_admin on public.user_generation_products for all
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    and exists (
      select 1 from public.user_generations g
      join public.profiles tp on tp.id = g.user_id
      where g.id = user_generation_products.generation_id and tp.is_ai = true
    )
  )
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    and exists (
      select 1 from public.user_generations g
      join public.profiles tp on tp.id = g.user_id
      where g.id = user_generation_products.generation_id and tp.is_ai = true
    )
  );

-- ============================================================
-- user_generation_slots
-- ============================================================
drop policy if exists user_generation_slots_admin_read on public.user_generation_slots;
create policy user_generation_slots_admin_read on public.user_generation_slots for select
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    and exists (select 1 from public.profiles where id = user_generation_slots.user_id and is_ai = true)
  );

drop policy if exists user_generation_slots_admin_write on public.user_generation_slots;
create policy user_generation_slots_admin_write on public.user_generation_slots for insert
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    and exists (select 1 from public.profiles where id = user_generation_slots.user_id and is_ai = true)
  );

drop policy if exists user_generation_slots_admin_update on public.user_generation_slots;
create policy user_generation_slots_admin_update on public.user_generation_slots for update
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    and exists (select 1 from public.profiles where id = user_generation_slots.user_id and is_ai = true)
  )
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    and exists (select 1 from public.profiles where id = user_generation_slots.user_id and is_ai = true)
  );

drop policy if exists user_generation_slots_admin_delete on public.user_generation_slots;
create policy user_generation_slots_admin_delete on public.user_generation_slots for delete
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    and exists (select 1 from public.profiles where id = user_generation_slots.user_id and is_ai = true)
  );

-- ============================================================
-- Storage: user-uploads bucket. Admins can upload/delete to any AI
-- persona's <uid>/ prefix; the foldername check pairs with the same
-- AI gate as the table policies.
-- ============================================================
drop policy if exists user_uploads_bucket_admin_insert on storage.objects;
create policy user_uploads_bucket_admin_insert on storage.objects for insert
  with check (
    bucket_id = 'user-uploads'
    and exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    and exists (
      select 1 from public.profiles
      where id::text = (storage.foldername(name))[1] and is_ai = true
    )
  );

drop policy if exists user_uploads_bucket_admin_delete on storage.objects;
create policy user_uploads_bucket_admin_delete on storage.objects for delete
  using (
    bucket_id = 'user-uploads'
    and exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    and exists (
      select 1 from public.profiles
      where id::text = (storage.foldername(name))[1] and is_ai = true
    )
  );
