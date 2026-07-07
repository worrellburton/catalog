-- scrape-new-products: only fire for rows that actually need scraping.
--
-- The trigger fired AFTER INSERT on EVERY product with no WHEN clause, POSTing
-- the row to the Modal scraper regardless of scrape_status. API-sourced products
-- (Shopify sync, etc.) arrive fully populated with scrape_status='done', but the
-- trigger re-scraped their storefront URLs anyway — pointless (data already
-- present) and doomed (Shopify blocks bots / dev stores are password-gated). The
-- failed scrape stamped scrape_status='failed' and is_platform=false, which
-- permanently blocked those rows from activation.
--
-- Fix: gate the trigger on scrape_status='pending' (the column default for
-- genuinely-crawled products). Rows the sync marked 'done' are left untouched.
-- Normal crawl flow is unchanged (those insert with the 'pending' default).

drop trigger if exists "scrape-new-products" on public.products;

create trigger "scrape-new-products"
  after insert on public.products
  for each row
  when (new.scrape_status = 'pending')
  execute function supabase_functions.http_request(
    'https://catalog--scrape-product.modal.run',
    'POST',
    '{"Content-type":"application/json"}',
    '{}',
    '5000'
  );
