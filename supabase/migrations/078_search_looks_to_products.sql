-- 070 — search_looks_to_products: project look matches as product rows
--
-- Phase 1 of the search overhaul ships looks-lane retrieval to the existing
-- product-shaped client without changes. For each top look matched by
-- search_looks_hybrid, return its highest-priority product (lowest
-- sort_order in look_products) as a search_products_hybrid-shaped row.
--
-- This means a vibe / occasion query like "date night" or "summer outfit"
-- routes through looks (which actually have those phrases in their
-- concept_doc / title / description) and surfaces the shoppable items
-- inside those looks.

drop function if exists public.search_looks_to_products(vector, text, int, text, uuid[]);

create or replace function public.search_looks_to_products(
  query_embedding vector(1536),
  query_text      text,
  k               int     default 24,
  filter_gender   text    default null,
  exclude_ids     uuid[]  default '{}'::uuid[]
)
returns table(
  id                uuid,
  product_id        uuid,
  video_url         text,
  thumbnail_url     text,
  affiliate_url     text,
  duration_seconds  numeric,
  is_elite          boolean,
  product_name      text,
  product_brand     text,
  product_price     text,
  product_image_url text,
  product_url       text,
  product_gender    text,
  product_type      text,
  concept_doc       text,
  concept_facets    jsonb,
  rrf_score         double precision,
  dense_rank        bigint,
  bm25_rank         bigint,
  -- Extra metadata so the client / nl-search can surface the look context.
  source_look_id    uuid,
  source_look_title text
)
language sql
stable
as $$
  with look_hits as (
    -- Get top looks via the hybrid RPC (no exclude — the look_id space is
    -- separate from product_id space).
    select * from public.search_looks_hybrid(
      query_embedding,
      query_text,
      k * 2,             -- over-fetch so dedup-by-product_id has headroom
      filter_gender,
      '{}'::uuid[],
      8
    )
  ),
  ranked_products as (
    -- For each look, pick the lowest-sort_order product that is active and
    -- not in exclude_ids. Window function gives us the top-N per look.
    select
      lh.look_id,
      lh.look_title,
      lh.rrf_score,
      lh.dense_rank,
      lh.bm25_rank,
      lp.product_id,
      row_number() over (
        partition by lh.look_id
        order by lp.sort_order asc nulls last, lp.added_at asc
      ) as rn
    from look_hits lh
    join public.look_products lp on lp.look_id = lh.look_id
    join public.products p       on p.id       = lp.product_id
    where p.is_active = true
      and (exclude_ids is null or array_length(exclude_ids, 1) is null or p.id <> all(exclude_ids))
  ),
  -- Take top product per look, then dedupe across looks (a product appearing
  -- in multiple matched looks shows up once at its best look's score).
  per_look_top as (
    select * from ranked_products where rn = 1
  ),
  deduped as (
    select distinct on (product_id)
      product_id,
      look_id,
      look_title,
      rrf_score,
      dense_rank,
      bm25_rank
    from per_look_top
    order by product_id, rrf_score desc
  )
  select
    p.id,
    p.id           as product_id,
    null::text     as video_url,
    null::text     as thumbnail_url,
    null::text     as affiliate_url,
    null::numeric  as duration_seconds,
    p.is_elite,
    p.name         as product_name,
    p.brand        as product_brand,
    p.price        as product_price,
    p.image_url    as product_image_url,
    p.url          as product_url,
    p.gender       as product_gender,
    p.type         as product_type,
    p.concept_doc,
    p.concept_facets,
    d.rrf_score,
    d.dense_rank,
    d.bm25_rank,
    d.look_id      as source_look_id,
    d.look_title   as source_look_title
  from deduped d
  join public.products p on p.id = d.product_id
  order by d.rrf_score desc
  limit k;
$$;

comment on function public.search_looks_to_products is
  'Looks-lane retrieval projected as product rows. Used by nl-search for vibe / occasion / outfit intents so existing product-shaped clients stay unchanged.';
