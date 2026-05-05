-- 080: SEARCH_V3 — product-first search with creative hydration.
--
-- Goal: every active product is searchable from day one regardless of
-- whether a live creative has been generated yet. Replaces
-- search_creatives_hybrid as the primary retrieval path.
--
-- Flow:
--   1. Filter active products (gender + optional type + exclude_ids).
--   2. Dense lane: ANN over products.text_embedding.
--   3. BM25 lane: weighted FTS over name(A), brand(B), type(B),
--      concept_doc(B), facet_text(C), description(C).
--   4. RRF-fuse top-k product candidates.
--   5. LEFT JOIN best live creative per product (prefer is_elite, then
--      impressions). Rows without a creative arrive with creative_id NULL
--      and is_placeholder=true so the client renders an image card.
--
-- Same column names that CreativeCard / ContinuousFeed already consume —
-- only the new is_placeholder flag is added.

drop function if exists public.search_products_with_creatives(
  vector, text, int, text, text[], boolean, uuid[]
);

create or replace function public.search_products_with_creatives(
  query_embedding  vector(1536),
  query_text       text,
  k                int     default 24,
  filter_gender    text    default null,
  filter_types     text[]  default null,
  require_elite    boolean default false,
  exclude_ids      uuid[]  default '{}'::uuid[]
)
returns table(
  -- Product fields (always present)
  id                uuid,                -- product_id (acts as row id when no creative)
  product_id        uuid,
  product_name      text,
  product_brand     text,
  product_price     text,
  product_type      text,
  product_gender    text,
  product_image_url text,
  product_url       text,
  -- Creative fields (NULL when no live creative exists)
  creative_id       uuid,
  video_url         text,
  thumbnail_url     text,
  affiliate_url     text,
  duration_seconds  numeric,
  is_elite          boolean,
  is_placeholder    boolean,
  -- Search metadata
  concept_doc       text,
  concept_facets    jsonb,
  facet_text        text,
  rrf_score         double precision,
  dense_rank        bigint,
  bm25_rank         bigint,
  type_match        boolean
)
language sql
stable
as $$
  with candidates as (
    select p.id
    from public.products p
    where p.is_active = true
      and (filter_gender is null or p.gender is null or p.gender = filter_gender or p.gender = 'unisex')
      and (
        filter_types is null
        or array_length(filter_types, 1) is null
        or (p.type is not null and p.type = any(filter_types))
      )
      and (exclude_ids is null or array_length(exclude_ids, 1) is null or p.id <> all(exclude_ids))
  ),
  dense as (
    select
      c.id,
      row_number() over (order by p.text_embedding <=> query_embedding) as rk
    from candidates c
    join public.products p on p.id = c.id
    where p.text_embedding is not null
    order by p.text_embedding <=> query_embedding
    limit k * 6
  ),
  bm25 as (
    select
      c.id,
      row_number() over (
        order by ts_rank_cd(
          setweight(to_tsvector('english', coalesce(p.name,         '')), 'A') ||
          setweight(to_tsvector('english', coalesce(p.brand,        '')), 'B') ||
          setweight(to_tsvector('english', coalesce(p.type,         '')), 'B') ||
          setweight(to_tsvector('english', coalesce(p.concept_doc,  '')), 'B') ||
          setweight(to_tsvector('english', coalesce(p.facet_text,   '')), 'C') ||
          setweight(to_tsvector('english', coalesce(p.description,  '')), 'C'),
          websearch_to_tsquery('english', query_text)
        ) desc
      ) as rk
    from candidates c
    join public.products p on p.id = c.id
    where coalesce(btrim(query_text), '') <> ''
      and (
        setweight(to_tsvector('english', coalesce(p.name,         '')), 'A') ||
        setweight(to_tsvector('english', coalesce(p.brand,        '')), 'B') ||
        setweight(to_tsvector('english', coalesce(p.type,         '')), 'B') ||
        setweight(to_tsvector('english', coalesce(p.concept_doc,  '')), 'B') ||
        setweight(to_tsvector('english', coalesce(p.facet_text,   '')), 'C') ||
        setweight(to_tsvector('english', coalesce(p.description,  '')), 'C')
      ) @@ websearch_to_tsquery('english', query_text)
    limit k * 6
  ),
  fused as (
    select
      coalesce(d.id, b.id) as id,
      (coalesce(1.0 / (60.0 + d.rk), 0.0) +
       coalesce(1.0 / (60.0 + b.rk), 0.0))::double precision as rrf_score,
      d.rk as dense_rank,
      b.rk as bm25_rank
    from dense d
    full outer join bm25 b on d.id = b.id
  ),
  top_products as (
    select * from fused
    order by rrf_score desc
    limit k
  ),
  best_creative as (
    -- Pick the best live creative per matched product. Prefer elite,
    -- then most-served. impressions may be NULL on fresh creatives —
    -- coalesce so they don't sort behind 0-impression rows.
    select distinct on (pc.product_id)
      pc.product_id,
      pc.id              as creative_id,
      pc.video_url,
      pc.thumbnail_url,
      pc.affiliate_url,
      pc.duration_seconds,
      pc.is_elite
    from public.product_creative pc
    where pc.product_id in (select id from top_products)
      and pc.status = 'live'
      and pc.enabled = true
      and pc.video_url is not null
    order by pc.product_id, pc.is_elite desc nulls last, coalesce(pc.impressions, 0) desc
  )
  select
    p.id                   as id,
    p.id                   as product_id,
    p.name                 as product_name,
    p.brand                as product_brand,
    p.price                as product_price,
    p.type                 as product_type,
    p.gender               as product_gender,
    p.image_url            as product_image_url,
    p.url                  as product_url,
    bc.creative_id,
    bc.video_url,
    bc.thumbnail_url,
    bc.affiliate_url,
    bc.duration_seconds,
    coalesce(bc.is_elite, false) as is_elite,
    (bc.creative_id is null)     as is_placeholder,
    p.concept_doc,
    p.concept_facets,
    p.facet_text,
    tp.rrf_score,
    tp.dense_rank,
    tp.bm25_rank,
    -- type_match: true when filter_types matched the actual product type;
    -- null when no filter was applied; false when soft-relaxed (the new
    -- RPC does not soft-relax — kept for shape compat with the old caller).
    case
      when filter_types is null or array_length(filter_types, 1) is null then null
      when p.type is not null and p.type = any(filter_types) then true
      else false
    end as type_match
  from top_products tp
  join public.products p on p.id = tp.id
  left join best_creative bc on bc.product_id = tp.id
  where (require_elite = false or bc.is_elite = true)
  order by tp.rrf_score desc;
$$;

grant execute on function public.search_products_with_creatives(
  vector(1536), text, int, text, text[], boolean, uuid[]
) to anon, authenticated, service_role;

comment on function public.search_products_with_creatives(
  vector(1536), text, int, text, text[], boolean, uuid[]
) is 'SEARCH_V3 primary RPC: product-first hybrid search with best-creative LEFT JOIN. Returns is_placeholder=true for products without a live creative.';
