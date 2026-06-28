-- StyleUp research traces — a structured record of how each stylist turn was
-- produced, for the admin "view research" node diagram. payload is written by
-- the style-up-chat edge fn (context, persona, what was sent to the model, the
-- reply + queries); searches is enriched client-side (per-query web results +
-- imports). Admin-only debug surface.
create table if not exists public.style_up_traces (
  id              uuid primary key default gen_random_uuid(),
  thread_id       uuid not null references public.style_up_threads(id) on delete cascade,
  shopper_user_id uuid,
  stylist_id      uuid,
  source_mode     text,                         -- 'catalog' | 'web'
  payload         jsonb not null default '{}'::jsonb,  -- edge-written turn record
  searches        jsonb,                        -- client-enriched per-query web results
  created_at      timestamptz not null default now()
);
create index if not exists style_up_traces_thread_idx
  on public.style_up_traces (thread_id, created_at desc);

alter table public.style_up_traces enable row level security;

-- Owner (the shopper) can read/enrich their own; admins see all.
drop policy if exists style_up_traces_owner on public.style_up_traces;
create policy style_up_traces_owner on public.style_up_traces
  for all
  using (shopper_user_id = auth.uid()
         or exists (select 1 from public.profiles p where p.id = auth.uid()
                    and (p.is_admin = true or p.role in ('admin','super_admin'))))
  with check (shopper_user_id = auth.uid()
         or exists (select 1 from public.profiles p where p.id = auth.uid()
                    and (p.is_admin = true or p.role in ('admin','super_admin'))));
