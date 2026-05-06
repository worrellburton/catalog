-- Add url_resolved flag to products table.
-- NULL  = never attempted by the URL resolver agent
-- TRUE  = successfully resolved to a direct merchant URL
-- FALSE = resolution attempted but no merchant URL found
alter table products
  add column if not exists url_resolved boolean default null;
