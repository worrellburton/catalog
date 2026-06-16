-- Live admin Data → Products: the admin list subscribes to postgres_changes on
-- public.products (INSERT for new adds, UPDATE when a scrape/video resolves),
-- but the table was never added to the supabase_realtime publication, so no
-- events fired and the admin had to refresh to see scraped products. Publish it
-- (and set REPLICA IDENTITY FULL so UPDATE payloads carry the full row).
alter publication supabase_realtime add table public.products;
alter table public.products replica identity full;
