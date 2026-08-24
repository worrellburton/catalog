-- Phase 2.3: RLS so a human stylist can see + reply into threads assigned
-- to them. Existing policies covered "shopper owns thread" and "admin";
-- adds a third case: "the auth user is the linked human stylist on the
-- thread". Style-up-chat edge fn keeps writing via service-role and is
-- unaffected.

drop policy if exists style_up_threads_owner on public.style_up_threads;
create policy style_up_threads_owner
  on public.style_up_threads
  for all
  to authenticated
  using (
    shopper_user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.is_admin = true or p.role in ('admin','super_admin'))
    )
    or exists (
      select 1 from public.style_up_stylists s
      where s.id = style_up_threads.stylist_id
        and s.human_user_id = auth.uid()
    )
  )
  with check (
    shopper_user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.is_admin = true or p.role in ('admin','super_admin'))
    )
    or exists (
      select 1 from public.style_up_stylists s
      where s.id = style_up_threads.stylist_id
        and s.human_user_id = auth.uid()
    )
  );

drop policy if exists style_up_messages_owner on public.style_up_messages;
create policy style_up_messages_owner
  on public.style_up_messages
  for all
  to authenticated
  using (
    exists (
      select 1 from public.style_up_threads t
      where t.id = style_up_messages.thread_id
        and (
          t.shopper_user_id = auth.uid()
          or exists (
            select 1 from public.profiles p
            where p.id = auth.uid()
              and (p.is_admin = true or p.role in ('admin','super_admin'))
          )
          or exists (
            select 1 from public.style_up_stylists s
            where s.id = t.stylist_id
              and s.human_user_id = auth.uid()
          )
        )
    )
  )
  with check (
    exists (
      select 1 from public.style_up_threads t
      where t.id = style_up_messages.thread_id
        and (
          t.shopper_user_id = auth.uid()
          or exists (
            select 1 from public.profiles p
            where p.id = auth.uid()
              and (p.is_admin = true or p.role in ('admin','super_admin'))
          )
          or exists (
            select 1 from public.style_up_stylists s
            where s.id = t.stylist_id
              and s.human_user_id = auth.uid()
          )
        )
    )
  );
