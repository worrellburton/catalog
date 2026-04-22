-- Admins can UPDATE public.products.
-- The consumer app reads products (public SELECT) and the scraper
-- inserts them (authenticated INSERT). Until now there was no UPDATE
-- policy, so admin-driven mutations from the dashboard (catalog_tags,
-- is_active, hook_copy, etc.) were silently blocked by RLS — the
-- Supabase client reports no error but 0 rows are affected.
--
-- This adds an UPDATE policy scoped to the admin role in
-- public.profiles so catalog tagging, auto-tag batches, and the
-- Add Products picker can write through a normal session.

DROP POLICY IF EXISTS "Admins can update products" ON public.products;
CREATE POLICY "Admins can update products" ON public.products
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
