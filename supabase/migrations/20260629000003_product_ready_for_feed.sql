-- Catalog Seeding — the real quality gate predicate.
-- A product is feed-ready when it has a real image AND non-empty occasion
-- styling (the surfacing signal search/catalogs rank on). Intentionally does
-- NOT use quality_score (verified dead: median 100, read by nothing).
-- Function only; the activation cron that consumes it ships in a later stage,
-- so this changes no behavior on its own. See docs/CATALOG_SEEDING.md.

create or replace function public.product_ready_for_feed(prod public.products)
returns boolean
language sql
stable
as $$
  select
    -- (1) has a real image
    (
      (prod.image_url is not null and btrim(prod.image_url) <> '')
      or (prod.images is not null and jsonb_array_length(prod.images) > 0)
      or prod.primary_image_url is not null
    )
    and
    -- (2) has non-empty occasion styling (handles string or array shape)
    (
      case
        when prod.styling_metadata is null then false
        when prod.styling_metadata -> 'occasion' is null then false
        when jsonb_typeof(prod.styling_metadata -> 'occasion') = 'array'
          then jsonb_array_length(prod.styling_metadata -> 'occasion') > 0
        when jsonb_typeof(prod.styling_metadata -> 'occasion') = 'string'
          then length(btrim(prod.styling_metadata ->> 'occasion')) > 0
        else false
      end
    );
$$;
