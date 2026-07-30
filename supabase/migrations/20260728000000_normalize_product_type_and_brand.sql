-- Two write-side normalizations that both ingest paths (product-search insert
-- and the Modal scraper's update) need, applied once where they converge
-- instead of separately in TypeScript and Python.
--
-- 1. TYPE CASE. 'shirt' and 'Shirt' were separate buckets for anything that
--    groups by type (filters, stylist slot retrieval, catalog assignment):
--    shirt/Shirt 72 products, shorts/Shorts 39, pants/Pants 31, skincare/
--    Skincare 11 = 153 products split in two. The search RPC was fixed
--    read-side in 20260709000000; this fixes the data.
--
-- 2. RETAILER-AS-BRAND. 47 active products stored a retailer as the brand
--    (Famous Footwear for Cole Haan, Nordstrom Rack for AllSaints, Macy's for
--    Ted Baker). It arrives from BOTH writers: guessBrand() falls back to
--    SerpAPI's merchant `source` (30 rows, scrape failed), and the scraper
--    reads the retailer's own og:brand off a marketplace PDP (17 rows, scrape
--    done). Hence a trigger, not a patch to either caller.

create or replace function public.normalize_retailer_brand(p_name text, p_brand text)
returns text language sql immutable as $$
  -- Only rewrites when the stored brand is a known multi-brand retailer AND
  -- the title carries a usable brand prefix. Returns p_brand untouched
  -- otherwise, so this can never invent a brand out of nothing. Verified on
  -- live data: leaves genuine house brands alone ("Nordstrom Mitchell Sneaker"
  -- stays Nordstrom) because those titles carry no gender qualifier.
  -- ponytail: retailer list is inline. Move to app_settings only if editing it
  -- without a migration actually becomes a chore.
  select case
    when p_brand is null or p_name is null then p_brand
    when lower(btrim(p_brand)) not in (
      'dsw','macy''s','macys','nordstrom','nordstrom rack','famous footwear',
      'revolve','walmart','kohl''s','kohls','target','men''s wearhouse',
      'dick''s sporting goods','huckberry','zappos','journeys','neiman marcus',
      'jd sports','foot locker','amazon','amazon.com','sam''s club','dillard''s',
      'saks fifth avenue','bloomingdale''s','shopbop','asos','farfetch','ssense',
      'ebay','etsy','overstock','costco','belk','jcpenney','rack room shoes',
      'shoe carnival','rei','backcountry','scheels','boot barn','shoes.com',
      '6pm','zalando','lyst','poshmark','stockx','goat','nordstromrack.com',
      'kohls.com','dsw.com','journeys.com','famousfootwear.com'
    ) then p_brand
    else coalesce(
      nullif(
        -- Prefix before the first gender qualifier: SerpAPI/marketplace titles
        -- lead with the real brand ("Cole Haan Men's Grand+ Court Sneakers").
        -- Bounded to 4 words; anything longer is prose, not a brand.
        (select case when array_length(regexp_split_to_array(btrim(h), '\s+'), 1) between 1 and 4
                     then btrim(h) end
           from (select substring(p_name from
                   '^(.*?)\s+(?:[Mm]en|[Ww]omen|[Kk]ids?|[Bb]oys|[Gg]irls|[Uu]nisex)(?:''s)?\M') as h) s),
        ''),
      p_brand)
  end
$$;

create or replace function public.products_normalize_write()
returns trigger language plpgsql as $$
begin
  if NEW.type is not null then
    NEW.type := lower(btrim(NEW.type));
  end if;
  NEW.brand := public.normalize_retailer_brand(NEW.name, NEW.brand);
  return NEW;
end;
$$;

drop trigger if exists trg_products_normalize_write on public.products;
create trigger trg_products_normalize_write
  before insert or update of name, brand, type on public.products
  for each row execute function public.products_normalize_write();

-- Taxonomy table carries the same case drift (Fragrance/Book/Sweater/Sports).
-- Verified 0 case-collisions, so lowering cannot violate the unique on name.
update public.product_types set name = lower(name) where name <> lower(name);

-- Backfill (run once, 2026-07-28). The BEFORE trigger does the rewriting, so a
-- no-op assignment is enough to normalize every existing row.
-- Result: 75 types + 30 brands rewritten, 0 type-case collisions remaining.
-- Rollback: table public.products_brand_type_backup_20260728 holds the
-- pre-change id/brand/type/is_active for all 436 rows.
update public.products set type = type where type is not null or brand is not null;

-- Google search-page URLs can never resolve to a buyable PDP (54 rows, all
-- created 2026-07-01 before the isGoogleUrl guard shipped in product-search
-- v38 the next morning). Deactivate rather than delete: the rows carry good
-- images and now-correct brands, so they are re-sourceable via product-search.
-- Reverse: update products set is_active=true where url like '%google.com/search%';
update public.products
   set is_active = false
 where is_active
   and url like '%google.com/search%';
