-- Catalog Seeding — fix activation gate: drop the scrape_status<>'failed'
-- guard. SerpAPI-ingested products already carry an image, but the
-- scrape-new-products trigger tries to re-scrape their URLs, fails, and stamps
-- scrape_status='failed' — which wrongly blocked otherwise-ready rows. The
-- product_ready_for_feed gate (image + occasion) is the real filter: a truly
-- broken product has no image and fails it regardless of scrape_status.
-- See docs/CATALOG_SEEDING.md.

create or replace function public.run_seeding_activation()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  enabled text;
begin
  select value into enabled from public.app_settings where key = 'seeding_enabled';
  if coalesce(enabled, 'false') <> 'true' then
    return 0;
  end if;

  update public.products p
    set is_active = true
  where p.is_active = false
    and p.is_platform is not false
    and public.product_ready_for_feed(p)
    and not exists (
      select 1 from public.admin_hidden_products h
      where lower(h.brand) = lower(coalesce(p.brand, ''))
        and lower(h.name)  = lower(coalesce(p.name, ''))
    );

  get diagnostics n = row_count;
  return n;
end $$;
