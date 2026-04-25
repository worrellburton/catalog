-- Waitlist: switch admin RLS from `role = 'admin'` to the canonical
-- `is_admin = true` flag (introduced in 037). Without this, admins
-- whose `role` column has been changed (e.g. demoted to 'creator' or
-- 'shopper' via the role badge in /admin/users) lose access to the
-- waitlist table and the Waitlist tab silently shows "No one
-- currently on the waitlist." even when there are pending entries.

drop policy if exists "waitlist_admin_all" on public.waitlist;
create policy "waitlist_admin_all" on public.waitlist
  for all to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  )
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );
