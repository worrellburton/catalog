-- Catalog Seeding — foundation: the seed_targets work queue + settings.
-- Demand-driven seeding backbone. Each row is ONE seed target (a search
-- keyword or a stylist scenario) that the seeding loop expands -> fetches
-- products -> gates -> publishes. See docs/CATALOG_SEEDING.md.
-- Purely additive; changes no existing table.

create table if not exists public.seed_targets (
  id                  uuid primary key default gen_random_uuid(),
  term                text not null,
  kind                text not null default 'keyword'
                        check (kind in ('keyword','scenario','manual')),
  status              text not null default 'pending'
                        check (status in ('pending','approved','paused','rejected','done')),
  priority            integer not null default 0,
  search_hits         integer not null default 0,
  zero_result         boolean not null default false,
  last_run_at         timestamptz,
  run_count           integer not null default 0,
  products_found      integer not null default 0,
  products_published  integer not null default 0,
  last_result         jsonb,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- one row per (term, kind); refresh upserts on this
create unique index if not exists seed_targets_term_kind_uidx
  on public.seed_targets (lower(term), kind);

-- scheduler picks due targets: approved, highest priority, least-recently run
create index if not exists seed_targets_schedule_idx
  on public.seed_targets (status, priority desc, last_run_at nulls first);

create or replace function public.seed_targets_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_seed_targets_touch on public.seed_targets;
create trigger trg_seed_targets_touch
  before update on public.seed_targets
  for each row execute function public.seed_targets_touch_updated_at();

alter table public.seed_targets enable row level security;

drop policy if exists "seed_targets_service_role" on public.seed_targets;
create policy "seed_targets_service_role" on public.seed_targets
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "seed_targets_admin" on public.seed_targets;
create policy "seed_targets_admin" on public.seed_targets
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- kill-switch + budget (fail-closed: seeding starts OFF)
insert into public.app_settings (key, value) values
  ('seeding_enabled', 'false'),
  ('seeding_monthly_serpapi_cap', '5000'),
  ('seeding_serpapi_used_month', '0')
on conflict (key) do nothing;
