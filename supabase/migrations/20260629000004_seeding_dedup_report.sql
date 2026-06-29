-- Catalog Seeding — non-destructive duplicate report.
-- product-search already dedups by url at insert (the main dup vector), and
-- products are FK-referenced by looks/catalogs, so a destructive cleanup +
-- hard unique index is NOT justified (only 1 lower(url) dup exists today).
-- ponytail: report only; upgrade path = review here, FK-safe merge, THEN add a
-- partial unique index on lower(url). See docs/CATALOG_SEEDING.md.

create or replace function public.seed_duplicate_report()
returns table(kind text, key text, n bigint, ids uuid[])
language sql
stable
as $$
  select 'url'::text, lower(btrim(url)),
         count(*), array_agg(id order by created_at)
  from public.products
  where url is not null and btrim(url) <> ''
  group by lower(btrim(url))
  having count(*) > 1
  union all
  select 'brand_name'::text,
         lower(coalesce(brand,'')) || '|' || lower(coalesce(name,'')),
         count(*), array_agg(id order by created_at)
  from public.products
  group by lower(coalesce(brand,'')) || '|' || lower(coalesce(name,''))
  having count(*) > 1;
$$;

grant execute on function public.seed_duplicate_report() to authenticated, service_role;
