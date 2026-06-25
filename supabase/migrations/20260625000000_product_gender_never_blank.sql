-- Gender should never be blank ("-") on a product.
--
-- Two parts:
--   1. Backfill every product currently missing a gender. Derive male/female
--      from explicit gender tokens in the NAME ("… Men …", "Women's …");
--      everything else (snowboards, ski wax, icons, gift cards, books, …)
--      defaults to 'unisex' — the same fallback proposeProductGenders uses.
--   2. Make 'unisex' the column DEFAULT so any future insert that omits the
--      gender lands on unisex instead of NULL.
--
-- This covers INACTIVE products too (the governance "Kaizen gender" sweep only
-- scans active rows, which is why the blank test snowboards never surfaced
-- there). Idempotent — re-running changes nothing once every row has a gender.

-- Men's items first (name says men / male / boys, and NOT women).
update products set gender = 'male'
where (gender is null or gender = '')
  and name ~* '(\ymen\y|\ymens\y|men''s|\ymale\y|\yboys?\y|gentlemen)'
  and name !~* '(\ywomen\y|\ywomens\y|women''s|\yladies\y|\ygirls?\y|\yfemale\y)';

-- Women's items (name says women / female / ladies / girls).
update products set gender = 'female'
where (gender is null or gender = '')
  and name ~* '(\ywomen\y|\ywomens\y|women''s|\yladies\y|\ygirls?\y|\yfemale\y|\yfemme\y)';

-- Everything still blank → unisex (no gender signal).
update products set gender = 'unisex'
where gender is null or gender = '';

-- Future inserts that omit gender default to unisex, never NULL.
alter table products alter column gender set default 'unisex';
