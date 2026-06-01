-- Site-wide realtime generation queue. Every AI job (anyone's) inserts a
-- row here when it starts and updates status on finish/fail. Admins read
-- ALL rows; a user reads their own. The GenerationQueueHost streams this
-- via Supabase realtime so an admin sees every shopper's generation live.
create table if not exists public.generation_jobs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid,
  kind         text not null,
  label        text not null,
  context      text,
  model        text,
  thumbnail_url text,
  status       text not null default 'running',
  estimated_ms integer,
  result_message text,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz
);
create index if not exists generation_jobs_status_started_idx on public.generation_jobs (status, started_at desc);
create index if not exists generation_jobs_user_idx on public.generation_jobs (user_id);

alter table public.generation_jobs enable row level security;

create policy generation_jobs_read on public.generation_jobs
  for select to public
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles me
      where me.id = auth.uid()
        and (me.is_admin = true or me.role in ('admin', 'super_admin'))
    )
  );

create policy generation_jobs_insert on public.generation_jobs
  for insert to authenticated
  with check (user_id = auth.uid() or user_id is null);

create policy generation_jobs_update on public.generation_jobs
  for update to public
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles me
      where me.id = auth.uid()
        and (me.is_admin = true or me.role in ('admin', 'super_admin'))
    )
  );

alter publication supabase_realtime add table public.generation_jobs;
