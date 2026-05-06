-- 073 - Add sort_order to product_creative so admins can drag-reorder
-- the per-product video tiles in /admin/content's expanded row.
--
-- Default backfill ranks existing rows by their created_at within each
-- product so the initial order matches what the UI showed before this
-- column existed (newest creatives last in the array, since the loader
-- iterates in insert order).

alter table product_creative
  add column if not exists sort_order integer not null default 0;

-- Backfill: rank rows by created_at within each product, 0-indexed.
-- After this, the index 'product_creative_sort_idx' below makes the
-- loader's ORDER BY sort_order, created_at cheap.
with ranked as (
  select id, row_number() over (
    partition by product_id
    order by created_at asc
  ) - 1 as rn
  from product_creative
)
update product_creative pc
set sort_order = ranked.rn
from ranked
where pc.id = ranked.id;

create index if not exists product_creative_sort_idx
  on product_creative (product_id, sort_order, created_at);

comment on column product_creative.sort_order is
  'Display order within a product''s creative tiles. Lower = earlier. Tied rows fall back to created_at.';
