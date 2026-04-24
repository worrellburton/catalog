-- Force PostgREST schema cache reload.
-- This migration exists solely to trigger a PostgREST schema reload
-- after the previous MCP-applied migrations (image_missing_reason,
-- is_active, admin_hidden_* tables) were applied without a CI deploy.
COMMENT ON TABLE public.products IS 'Scraped product catalog. Updated by the product-scraper Modal agent.';
COMMENT ON TABLE public.crawl_jobs IS 'Site and profile crawl jobs queued by the admin panel.';
