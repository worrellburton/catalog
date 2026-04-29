-- Allow admins (is_admin = true) to delete any profile. Without this
-- policy, the per-row delete buttons on /admin/users return RLS errors
-- ("Delete blocked by RLS. Sign in as an admin to remove profiles.")
-- even when the caller is a real admin.
--
-- Mirrors the update policy added in 037; uses the canonical is_admin
-- flag rather than the role text column so an admin elevated via the
-- /admin/users toggle keeps delete access regardless of their visible
-- role.

drop policy if exists profiles_admin_delete on public.profiles;
create policy profiles_admin_delete on public.profiles for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles me
      where me.id = auth.uid() and me.is_admin = true
    )
  );
