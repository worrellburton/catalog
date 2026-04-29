-- 054: Watchdog for stuck product scrapes.
--
-- Modal containers occasionally get killed mid-run (timeout, OOM, network),
-- which leaves products.scrape_status = 'processing' forever. The next time
-- the admin opens the Product Crawls panel we want any row that has been
-- "processing" for more than 20 minutes to flip to 'failed' so it shows up
-- in the failed tab and can be retried.

CREATE OR REPLACE FUNCTION reconcile_stuck_product_scrapes(stale_after_minutes int DEFAULT 20)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    affected int;
BEGIN
    WITH updated AS (
        UPDATE products
           SET scrape_status = 'failed',
               scrape_error  = COALESCE(
                   scrape_error,
                   'Auto-failed by watchdog: stuck in processing > ' || stale_after_minutes || ' minutes'
               ),
               scraped_at    = COALESCE(scraped_at, now())
         WHERE scrape_status = 'processing'
           AND COALESCE(scraped_at, created_at) < now() - (stale_after_minutes || ' minutes')::interval
         RETURNING id
    )
    SELECT count(*) INTO affected FROM updated;
    RETURN affected;
END;
$$;

GRANT EXECUTE ON FUNCTION reconcile_stuck_product_scrapes(int) TO anon, authenticated, service_role;
