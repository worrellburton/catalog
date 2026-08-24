-- Phase 4: admin arm for stylist_applications RLS.

drop policy if exists stylist_applications_admin_all on public.stylist_applications;
create policy stylist_applications_admin_all
  on public.stylist_applications
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.is_admin = true or p.role in ('admin','super_admin'))
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.is_admin = true or p.role in ('admin','super_admin'))
    )
  );
