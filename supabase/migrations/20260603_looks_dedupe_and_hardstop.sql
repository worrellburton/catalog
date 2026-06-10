-- One-time data cleanup + structural hard-stop so the looks table can
-- never carry two rows for the same primary video again.
--
-- The publish flow used to insert a new looks row on every admin click,
-- and the Unpublished tab kept listing the source generation until the
-- dedupe layer landed earlier in this session. Result: 7 historical
-- duplicate clusters (one with 8 copies, two with 5, the rest with 2).
-- Below we pick a keeper per cluster (live > draft, then newest), migrate
-- every child row to it, drop the losers, and add a partial unique index
-- on the primary creative's video_url so a future INSERT collides instead
-- of silently producing another duplicate.
--
-- Keeper-preference: status='live' wins over 'draft' so we don't archive
-- a published look in favour of a stale draft. Tie-break newest so the
-- post-merge row reflects the most recent metadata (title/description
-- edits, gender override, etc.).

begin;

create temp table _dedup_pairs on commit drop as
with primary_creatives as (
  select lc.look_id, lc.video_url
  from public.looks_creative lc
  where lc.is_primary = true
),
clusters as (
  select pc.video_url,
         array_agg(l.id order by
           case l.status when 'live' then 0 when 'draft' then 1 else 2 end,
           l.created_at desc
         ) as ordered_ids
  from primary_creatives pc
  join public.looks l on l.id = pc.look_id
  where l.archived_at is null
  group by pc.video_url
  having count(*) > 1
)
select
  ordered_ids[1] as keeper_id,
  unnest(ordered_ids[2:array_length(ordered_ids, 1)]) as loser_id
from clusters;

insert into public.look_products (look_id, product_id, sort_order)
select dp.keeper_id, lp.product_id, lp.sort_order
from public.look_products lp
join _dedup_pairs dp on dp.loser_id = lp.look_id
on conflict (look_id, product_id) do nothing;

delete from public.look_products
where look_id in (select loser_id from _dedup_pairs);

update public.catalog_looks cl
   set look_id = dp.keeper_id
  from _dedup_pairs dp
 where cl.look_id = dp.loser_id;

update public.look_photos    set look_id = dp.keeper_id from _dedup_pairs dp where look_id = dp.loser_id;
update public.look_videos    set look_id = dp.keeper_id from _dedup_pairs dp where look_id = dp.loser_id;
update public.generated_videos set look_id = dp.keeper_id from _dedup_pairs dp where look_id = dp.loser_id;

delete from public.looks_creative
where look_id in (select loser_id from _dedup_pairs);

delete from public.looks
where id in (select loser_id from _dedup_pairs);

commit;

-- Structural hard-stop. Any future INSERT into looks_creative with
-- is_primary=true on a video_url that's already a primary creative for
-- a live or draft look will now hit a 23505 unique violation instead of
-- silently landing in the table. Combined with the existing partial
-- unique on looks.source_generation_id, this blocks both ways a
-- duplicate ever entered: re-clicking Publish on the same generation
-- (caught by source_generation_id) and inserting a fresh looks row with
-- a video already in use (caught here).
create unique index if not exists looks_creative_one_primary_per_video
  on public.looks_creative (video_url)
  where is_primary = true;
