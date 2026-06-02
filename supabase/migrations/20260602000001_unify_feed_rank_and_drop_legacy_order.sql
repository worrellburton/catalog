-- The consumer home feed reads a SINGLE shared feed_rank across looks +
-- products to reproduce the admin /admin/catalogs FEED order. Two problems
-- had crept in:
--
--  1) A legacy apply_feed_order(look_ids uuid[], product_ids uuid[]) overload
--     ranked looks 1..N and products 1..N SEPARATELY, so a look and a product
--     both got feed_rank=1, =2, ... The consumer's "sort by feed_rank" then
--     interleaved them by array index (look1, product1, look2, product2 …)
--     instead of the admin's curated order. Drop it so only the unified
--     apply_feed_order(ordered_keys text[]) remains — one dense rank space.
--
--  2) The existing rows still carry those colliding per-type ranks. Re-rank
--     them into ONE unified sequence that reproduces the admin's kept
--     "Recommend Order" layout (2 looks : 1 product, best-first within each
--     type — exactly what the FEED page shows), so the live feed matches
--     without the admin having to re-save.

drop function if exists public.apply_feed_order(uuid[], uuid[]);

-- Re-rank: interleave 2 looks : 1 product by each type's existing feed_rank.
-- Block model: look i → block ceil(i/2), in-block slot (i-1)%2 (0/1);
-- product j → block j, slot 2 (sits after the (up to) 2 looks of that block;
-- overflow products land in their own later blocks). row_number over
-- (block, slot) collapses to a dense 1..N unified feed_rank.
with l as (
  select id, row_number() over (order by feed_rank, created_at desc) as r
  from public.looks where feed_rank is not null
),
p as (
  select id, row_number() over (order by feed_rank) as r
  from public.products where feed_rank is not null
),
items as (
  select id, 'look'::text as kind, ceil(r::numeric / 2) as block, ((r - 1) % 2) as slot from l
  union all
  select id, 'product'::text as kind, r::numeric as block, 2 as slot from p
),
unified as (
  select id, kind, row_number() over (order by block, slot) as new_rank
  from items
),
upd_looks as (
  update public.looks lo set feed_rank = u.new_rank
  from unified u where u.kind = 'look' and lo.id = u.id
  returning 1
)
update public.products pr set feed_rank = u.new_rank
from unified u where u.kind = 'product' and pr.id = u.id;
