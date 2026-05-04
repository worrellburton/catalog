-- Two-step cleanup of the products table:
--
-- 1. Delete obvious scrape failures whose name is a Cloudflare /
--    404 placeholder or is NULL — none of these belong on the
--    catalog and they pollute the admin counts. The set is small
--    and well-defined; future scrape runs that hit these same
--    placeholders should be filtered upstream, but a one-shot
--    delete here cleans the existing accumulation.
--
-- 2. Dedupe by (brand, name). Each (lower(brand), lower(name))
--    group is collapsed to one row by row_number() — the winner
--    is the one with is_active=true (Home toggle on), and within
--    that the most recently created row. Losers are deleted;
--    cascade FKs on look_products / product_creative /
--    generated_videos / catalog_products / user_generation_products
--    handle the child cleanup automatically.
--
-- The duplicates accumulated because the scraper key isn't
-- unique on (brand, name) — same product hit twice produced two
-- rows with different uuids. Either harden the scraper (upsert by
-- canonical url, then by brand+name as a fallback) or run this
-- dedupe periodically. Today it's a one-shot for the existing rows.

delete from products
where name in ('Unknown Product','Just a moment...','Product Not Found','404 Not Found')
   or name is null;

with ranked as (
  select id,
    row_number() over (
      partition by lower(coalesce(brand,'')), lower(name)
      order by (is_active = true) desc, created_at desc nulls last, id
    ) as rn
  from products
  where name is not null
    and name not in ('Unknown Product','Just a moment...','Product Not Found','404 Not Found')
)
delete from products
where id in (select id from ranked where rn > 1);
