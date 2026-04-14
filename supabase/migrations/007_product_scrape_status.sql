-- Add scrape tracking columns to products table
-- Run this in Supabase SQL editor before deploying the GitHub Actions workflow

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS scrape_status text NOT NULL DEFAULT 'pending'
    CHECK (scrape_status IN ('pending', 'processing', 'done', 'failed')),
  ADD COLUMN IF NOT EXISTS scraped_at timestamptz,
  ADD COLUMN IF NOT EXISTS scrape_error text,
  -- Richer product data populated by the scraper agent
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS discounted_price text,
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS images jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS availability text;

-- Index for the cron query (pending rows only)
CREATE INDEX IF NOT EXISTS idx_products_scrape_status
  ON products (scrape_status)
  WHERE scrape_status = 'pending';

-- Update existing rows that already have product data to 'done'
UPDATE products
SET scrape_status = 'done'
WHERE name IS NOT NULL AND scrape_status = 'pending';
