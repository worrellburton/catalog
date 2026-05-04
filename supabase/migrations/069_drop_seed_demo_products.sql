-- Drop the 8 seed demo products from migration 002_seed_data.sql.
--
-- These were hardcoded with deterministic ids (a0000000-…-001..008) for
-- the very first prototype. They never had a type, gender, or sensible
-- creative attached, but they had products.is_active default-true, so
-- they kept slotting onto the home grid (a Dune-tier inventory of a
-- gift card, two houseplants, a phone case, a digital camera, etc).
-- They also sit in look_products joins to the seed looks, which
-- propagates them into every "in N looks" stat on the admin Content
-- page.
--
-- The home-feed query already requires products.type IS NOT NULL so
-- they're hidden from the consumer feed today, but they keep
-- polluting the admin tables — admins keep asking what they are.
-- Permanently delete them and their join rows.

-- Best-effort delete on dependent rows first (no ON DELETE CASCADE
-- on look_products in the original schema).
delete from look_products
where product_id in (
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000003',
  'a0000000-0000-0000-0000-000000000004',
  'a0000000-0000-0000-0000-000000000005',
  'a0000000-0000-0000-0000-000000000006',
  'a0000000-0000-0000-0000-000000000007',
  'a0000000-0000-0000-0000-000000000008'
);

-- Drop any creatives that happen to reference them (defensive — none
-- exist in production today, but a future seed insert could).
delete from product_creative
where product_id in (
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000003',
  'a0000000-0000-0000-0000-000000000004',
  'a0000000-0000-0000-0000-000000000005',
  'a0000000-0000-0000-0000-000000000006',
  'a0000000-0000-0000-0000-000000000007',
  'a0000000-0000-0000-0000-000000000008'
);

-- Finally drop the products themselves.
delete from products
where id in (
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000003',
  'a0000000-0000-0000-0000-000000000004',
  'a0000000-0000-0000-0000-000000000005',
  'a0000000-0000-0000-0000-000000000006',
  'a0000000-0000-0000-0000-000000000007',
  'a0000000-0000-0000-0000-000000000008'
);
