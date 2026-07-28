-- Transitions and failures ONLY. Never current state - that is derived by
-- pipeline_stage(). Nothing here is authoritative, so nothing here can drift.
create table if not exists public.pipeline_events (
  id         bigserial primary key,
  product_id uuid references public.products(id) on delete cascade,
  stage      text not null,
  event      text not null,          -- queued|done|failed|published|blocked|skipped|budget
  detail     jsonb,
  created_at timestamptz not null default now()
);

create index if not exists pipeline_events_created_idx
  on public.pipeline_events (created_at desc);
create index if not exists pipeline_events_product_idx
  on public.pipeline_events (product_id, created_at desc);

alter table public.pipeline_events enable row level security;

-- Reads are admin-only. Writes are service-role only; service_role bypasses
-- RLS, so there is deliberately no INSERT policy.
drop policy if exists "admins read pipeline_events" on public.pipeline_events;
create policy "admins read pipeline_events" on public.pipeline_events
  for select using (
    exists (select 1 from public.profiles me
             where me.id = (select auth.uid()) and me.is_admin)
  );
