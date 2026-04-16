-- Allow creating products with just a URL — scraper fills in the rest
ALTER TABLE products ALTER COLUMN name DROP NOT NULL;
