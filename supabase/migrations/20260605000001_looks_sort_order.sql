-- Per-creator manual ordering for the My Catalog grid. Backfill the
-- initial order to match the current default (newest first) so the
-- grid doesn't visually reshuffle the first time it loads.
alter table public.looks add column if not exists sort_order int not null default 0;

with ranked as (
  select id, (row_number() over (partition by user_id order by created_at desc) - 1) as rn
  from public.looks
)
update public.looks l set sort_order = r.rn
from ranked r where r.id = l.id;

create index if not exists looks_user_sort_order_idx on public.looks (user_id, sort_order);
