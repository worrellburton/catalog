-- Admin write access to public.looks.
--
-- Before this, the only UPDATE/DELETE policies were owner-scoped
-- (user_id = auth.uid()), so the new "+ Add Looks to catalog" picker
-- (and any other admin curation flow) silently no-op'd whenever the
-- admin wasn't the look's creator. Toast in the picker now reports
-- "No looks were written" which is the symptom — fix is to grant
-- admins UPDATE + DELETE the same way profiles_admin_update does on
-- public.profiles.

create policy looks_admin_update on public.looks for update
  using (
    exists (
      select 1 from public.profiles me
      where me.id = auth.uid()
        and (me.is_admin = true or me.role in ('admin', 'super_admin'))
    )
  )
  with check (
    exists (
      select 1 from public.profiles me
      where me.id = auth.uid()
        and (me.is_admin = true or me.role in ('admin', 'super_admin'))
    )
  );

create policy looks_admin_delete on public.looks for delete
  using (
    exists (
      select 1 from public.profiles me
      where me.id = auth.uid()
        and (me.is_admin = true or me.role in ('admin', 'super_admin'))
    )
  );
