-- Shopper → creator applications. A shopper submits one request; an admin
-- approves (which promotes profiles.role to 'creator') or denies it.
create table if not exists public.become_creator_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','denied')),
  message text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);

-- One application per user.
create unique index if not exists become_creator_requests_user_idx
  on public.become_creator_requests (user_id);
create index if not exists become_creator_requests_status_idx
  on public.become_creator_requests (status, created_at desc);

alter table public.become_creator_requests enable row level security;

-- A user can file and read their own request (insert-once; no self-update so
-- they can't flip their own status).
drop policy if exists bcr_insert_own on public.become_creator_requests;
create policy bcr_insert_own on public.become_creator_requests
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists bcr_select_own on public.become_creator_requests;
create policy bcr_select_own on public.become_creator_requests
  for select to authenticated using (user_id = auth.uid());

-- Admins read every request (the review queue).
drop policy if exists bcr_admin_select on public.become_creator_requests;
create policy bcr_admin_select on public.become_creator_requests
  for select using (
    exists (
      select 1 from public.profiles me
      where me.id = auth.uid()
        and (me.is_admin = true or me.role in ('admin','super_admin'))
    )
  );

-- Approve/deny atomically + admin-gated. SECURITY DEFINER so the role bump
-- runs with table-owner rights; the profiles escalation trigger still sees
-- auth.uid() = the admin caller and allows it.
create or replace function public.review_creator_request(p_request_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_is_admin boolean;
begin
  select (is_admin = true or role in ('admin','super_admin'))
    into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then
    raise exception 'Insufficient privileges' using errcode = '42501';
  end if;

  select user_id into v_user from public.become_creator_requests where id = p_request_id;
  if v_user is null then
    raise exception 'Request not found';
  end if;

  update public.become_creator_requests
    set status = case when p_approve then 'approved' else 'denied' end,
        reviewed_at = now(),
        reviewed_by = auth.uid()
    where id = p_request_id;

  if p_approve then
    update public.profiles set role = 'creator' where id = v_user and role = 'shopper';
  end if;
end;
$$;

revoke all on function public.review_creator_request(uuid, boolean) from public;
grant execute on function public.review_creator_request(uuid, boolean) to authenticated;
