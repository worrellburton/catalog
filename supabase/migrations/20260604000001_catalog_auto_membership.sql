-- Catalog auto-membership — automatically place every active apparel product
-- into the catalogs whose theme it matches, and keep it fresh as products and
-- catalogs change. This is the engine behind the consumer product page's
-- "Popular in <catalog>" chips.
--
-- Why this exists
-- ---------------
-- catalog_auto_assign_products (the prior matcher) is run by hand, one catalog
-- at a time, capped at 24 products, and scores with trigram(name+brand) vs the
-- theme_prompt — which is why only ~6% of products ever land in a catalog.
--
-- This replaces that workflow for auto memberships with:
--   * a better signal — full-text rank over an ENRICHED product document
--     (name / type+taxonomy / styling-occasion / materials+description) scored
--     against the catalog theme_prompt as an OR query (match any vibe word,
--     rank by how many / how strongly). Validated to give sensible homes:
--     Air Force 1 -> Streetwear Sunday, cashmere crew -> Quiet Luxury,
--     linen blazer -> Coastal Grandma.
--   * full automation — a trigger refreshes a product the moment it is inserted
--     or its descriptive columns change (instant coverage for NEW products),
--     plus a nightly pg_cron rebuild that also picks up catalog theme edits.
--
-- Ownership: source='auto' rows are fully owned here (deleted + reinserted).
-- source='manual' / 'imported' rows are never touched, so admin pins survive.

-- Tunables (kept inline; this is the only place they live):
--   min score   = 0.6   a product joins a catalog only above this rank
--   per product = 3      a product keeps at most its 3 strongest catalogs
--   excluded types       non-apparel buckets never enter fashion vibe catalogs

-- ── Scoring core ────────────────────────────────────────────────────────────
-- Returns the (product, catalog, score) memberships a product qualifies for.
-- p_only scopes to a single product (trigger path); null scores all active
-- apparel products (backfill / nightly path).
create or replace function public.catalog_score_products(p_only uuid default null)
returns table(product_id uuid, catalog_id uuid, score real)
language sql
stable
as $$
  with cat as (
    select
      c.id,
      c.gender,
      -- plainto_tsquery ANDs every term; flip '&' -> '|' so a product that
      -- matches ANY vibe word qualifies, ranked by how many it hits.
      regexp_replace(plainto_tsquery('english', c.theme_prompt)::text, '&', '|', 'g')::tsquery as q
    from public.catalogs c
    where c.status = 'live'
      and coalesce(c.is_home, false) = false
      and coalesce(trim(c.theme_prompt), '') <> ''
  ),
  prod as (
    select
      p.id,
      p.gender,
      setweight(to_tsvector('english', coalesce(p.name, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(p.type, '') || ' ' || coalesce(p.subtype, '')), 'B') ||
      setweight(to_tsvector('english',
        coalesce(p.product_taxonomy->>'style', '') || ' ' ||
        coalesce(p.product_taxonomy->>'subcategory', '') || ' ' ||
        coalesce(p.product_taxonomy->>'category', '')), 'B') ||
      setweight(to_tsvector('english',
        coalesce((select string_agg(v, ' ') from jsonb_array_elements_text(
          case when jsonb_typeof(p.styling_metadata->'occasion') = 'array' then p.styling_metadata->'occasion' else '[]'::jsonb end) v), '') || ' ' ||
        coalesce((select string_agg(v, ' ') from jsonb_array_elements_text(
          case when jsonb_typeof(p.styling_metadata->'works_with') = 'array' then p.styling_metadata->'works_with' else '[]'::jsonb end) v), '') || ' ' ||
        coalesce((select string_agg(v, ' ') from jsonb_array_elements_text(
          case when jsonb_typeof(p.fit_intelligence->'best_for_occasions') = 'array' then p.fit_intelligence->'best_for_occasions' else '[]'::jsonb end) v), '')), 'B') ||
      setweight(to_tsvector('english',
        coalesce((select string_agg(m->>'fiber', ' ') from jsonb_array_elements(
          case when jsonb_typeof(p.materials_structured) = 'array' then p.materials_structured else '[]'::jsonb end) m), '') || ' ' ||
        coalesce(p.description, '')), 'C') as doc
    from public.products p
    where coalesce(p.is_active, true) = true
      and coalesce(p.name, '') <> ''
      -- Non-apparel buckets (home, books, grooming, food, beauty) never belong
      -- in fashion vibe catalogs even when stray words match.
      and coalesce(p.type, '') not in (
        'Decor', 'Book', 'Other', 'Haircare', 'Food', 'Beauty',
        'Home', 'Candle', 'Grooming', 'Fragrance', 'Wellness', 'Tech'
      )
      and (p_only is null or p.id = p_only)
  ),
  scored as (
    select
      pr.id as product_id,
      c.id  as catalog_id,
      ts_rank_cd(pr.doc, c.q) as score,
      row_number() over (partition by pr.id order by ts_rank_cd(pr.doc, c.q) desc) as rnk
    from prod pr
    join cat c
      on pr.doc @@ c.q
     and (c.gender = 'all' or pr.gender is null or pr.gender = c.gender or pr.gender = 'unisex')
    where ts_rank_cd(pr.doc, c.q) >= 0.6
  )
  select product_id, catalog_id, score
  from scored
  where rnk <= 3;
$$;

-- ── Per-product refresh (trigger path) ──────────────────────────────────────
create or replace function public.catalog_assign_product(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.catalog_products
  where product_id = p_product_id and source = 'auto';

  insert into public.catalog_products (catalog_id, product_id, sort_order, match_score, source)
  select
    s.catalog_id,
    s.product_id,
    greatest(1, 1000 - round(s.score * 100))::int,  -- stronger match -> earlier in the catalog feed
    s.score,
    'auto'
  from public.catalog_score_products(p_product_id) s
  on conflict (catalog_id, product_id) do nothing;     -- never clobber a manual pin
end;
$$;

-- ── Full rebuild (backfill + nightly) ───────────────────────────────────────
create or replace function public.catalog_refresh_all_auto()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.catalog_products where source = 'auto';

  insert into public.catalog_products (catalog_id, product_id, sort_order, match_score, source)
  select
    s.catalog_id,
    s.product_id,
    greatest(1, 1000 - round(s.score * 100))::int,
    s.score,
    'auto'
  from public.catalog_score_products(null) s
  on conflict (catalog_id, product_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── Trigger: keep new / edited products in sync automatically ────────────────
create or replace function public.trg_catalog_assign_product()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.catalog_assign_product(new.id);
  return new;
end;
$$;

drop trigger if exists catalog_assign_product_trg on public.products;
create trigger catalog_assign_product_trg
after insert or update of
  name, brand, type, subtype, description,
  styling_metadata, product_taxonomy, fit_intelligence, materials_structured,
  gender, is_active
on public.products
for each row
execute function public.trg_catalog_assign_product();

-- ── Read path: catalogs a product is "Popular in" (consumer product page) ────
-- Matched by name (+ optional brand) so the client need not carry a product id.
-- Reads catalog_products — the SAME source of truth as the catalog search feed —
-- so tapping a chip always lands in a feed that contains this product.
create or replace function public.get_product_catalogs(p_name text, p_brand text default null)
returns table(name text, slug text, match_score real)
language sql
stable
security definer
set search_path = public
as $$
  select s.name, s.slug, s.match_score
  from (
    select distinct on (c.id)
      c.name, c.slug, cp.match_score, c.sort_order
    from public.products p
    join public.catalog_products cp on cp.product_id = p.id
    join public.catalogs c on c.id = cp.catalog_id
    where c.status = 'live'
      and coalesce(c.is_home, false) = false
      and lower(trim(p.name)) = lower(trim(p_name))
      and (p_brand is null or trim(p_brand) = '' or lower(trim(p.brand)) = lower(trim(p_brand)))
    order by c.id, cp.match_score desc nulls last
  ) s
  order by s.match_score desc nulls last, s.sort_order
  limit 4;
$$;

grant execute on function public.get_product_catalogs(text, text) to anon, authenticated;

-- ── Nightly rebuild via pg_cron (catches catalog theme_prompt edits too) ─────
do $$
begin
  if exists (select 1 from cron.job where jobname = 'catalog-refresh-auto-nightly') then
    perform cron.unschedule('catalog-refresh-auto-nightly');
  end if;
end $$;

select cron.schedule(
  'catalog-refresh-auto-nightly',
  '17 7 * * *',                                -- 07:17 UTC nightly
  $cron$ select public.catalog_refresh_all_auto(); $cron$
);

-- ── Backfill now ────────────────────────────────────────────────────────────
select public.catalog_refresh_all_auto();
