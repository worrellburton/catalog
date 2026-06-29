-- Catalog Seeding — provenance link: which seed_target fetched each product.
-- Lets the admin view products per target (/admin/data?...&target=<id>). The
-- orchestrator stamps it on ingest; on-delete-set-null so deleting a target
-- doesn't delete its products. See docs/CATALOG_SEEDING.md.

alter table public.products
  add column if not exists seed_target_id uuid references public.seed_targets(id) on delete set null;

create index if not exists products_seed_target_idx
  on public.products (seed_target_id) where seed_target_id is not null;

-- Backfill existing seeded rows to the only target that has run so far
-- ("white shoes"); future rows get stamped at ingest by seed-run.
update public.products p
  set seed_target_id = (select id from public.seed_targets where term = 'white shoes' and kind = 'keyword' limit 1)
where p.source = 'seed_serpapi' and p.seed_target_id is null;
