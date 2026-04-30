-- 063: search_creatives_hybrid accepts filter_types text[] (and BM25 fallback when query_text is empty).
--
-- Why: the keyword-expansion search planner now resolves user queries to a
-- SET of catalog types ("shoes" → Sneakers/Boots/Sandals/…) rather than a
-- single value. We need a hard filter that restricts results to that set so
-- searches can never bleed into unrelated categories (the previous open-ended
-- semantic path was returning LMNT drinks and LEGO sets for "shoes").
--
-- Behaviour:
--   • filter_types null/empty  → no type restriction (legacy behaviour).
--   • filter_types non-empty   → p.type must be in the set; rows with null
--                                 type are excluded so we never surface
--                                 unclassified products under a strict query.
--   • If query_text is empty/whitespace, we bypass the BM25 lane entirely so
--     a pure type-filtered "browse all shoes" query returns by dense similarity
--     (or just by recency when no embedding is supplied either).
--
-- The previous single-value `filter_type` arg is removed; callers must pass
-- an array. Migration 061 was the only previous signature in use.

drop function if exists public.search_creatives_hybrid(vector, text, int, text, text, boolean, uuid[]);

create or replace function public.search_creatives_hybrid(
  query_embedding vector(1536),
  query_text      text,
  k               int     default 24,
  filter_gender   text    default null,
  filter_types    text[]  default null,
  require_elite   boolean default false,
  exclude_ids     uuid[]  default '{}'
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
  bm25_rank         bigint
)
language sql stable
as $$
  with
  candidates as (
    select pc.id, pc.product_id
    from public.product_creative pc
    join public.products p on p.id = pc.product_id
    where pc.status = 'live'
      and pc.enabled = true
      and pc.video_url is not null
      and p.is_active = true
      and (not require_elite or pc.is_elite = true)
      and (filter_gender is null or p.gender is null or p.gender = filter_gender or p.gender = 'unisex')
      -- Strict type filter: when filter_types is provided, the product MUST
      -- have a non-null type that's in the set. Unclassified products do not
      -- bleed in. When filter_types is null/empty, no restriction.
      and (
        filter_types is null
        or array_length(filter_types, 1) is null
        or (p.type is not null and p.type = any(filter_types))
      )
      and (exclude_ids is null or array_length(exclude_ids, 1) is null or pc.id <> all(exclude_ids))
  ),
  dense as (
    select
      c.id,
      row_number() over (order by pc.text_embedding <=> query_embedding) as rk
    from candidates c
    join public.product_creative pc on pc.id = c.id
    where pc.text_embedding is not null
    order by pc.text_embedding <=> query_embedding
    limit k * 4
  ),
  bm25 as (
    select
      c.id,
      row_number() over (
        order by ts_rank_cd(
          setweight(to_tsvector('english', coalesce(p.name,         '')), 'A') ||
          setweight(to_tsvector('english', coalesce(p.brand,        '')), 'B') ||
          setweight(to_tsvector('english', coalesce(p.type,         '')), 'B') ||
          setweight(to_tsvector('english', coalesce(p.description,  '')), 'C') ||
          setweight(to_tsvector('english', coalesce(pc.concept_doc, '')), 'A'),
          websearch_to_tsquery('english', query_text)
        ) desc
      ) as rk
    from candidates c
    join public.product_creative pc on pc.id = c.id
    join public.products p          on p.id  = c.product_id
    where coalesce(btrim(query_text), '') <> ''
      and (
        setweight(to_tsvector('english', coalesce(p.name,         '')), 'A') ||
        setweight(to_tsvector('english', coalesce(p.brand,        '')), 'B') ||
        setweight(to_tsvector('english', coalesce(p.type,         '')), 'B') ||
        setweight(to_tsvector('english', coalesce(p.description,  '')), 'C') ||
        setweight(to_tsvector('english', coalesce(pc.concept_doc, '')), 'A')
      ) @@ websearch_to_tsquery('english', query_text)
    limit k * 4
  ),
  fused as (
    select
      coalesce(d.id, b.id) as id,
      coalesce(1.0 / (60.0 + d.rk), 0.0) +
      coalesce(1.0 / (60.0 + b.rk), 0.0) as rrf_score,
      d.rk as dense_rank,
      b.rk as bm25_rank
    from dense d
    full outer join bm25 b on d.id = b.id
    order by rrf_score desc
    limit k
  )
  select
    pc.id,
    pc.product_id,
    pc.video_url,
    pc.thumbnail_url,
    pc.affiliate_url,
    pc.duration_seconds,
    pc.is_elite,
    p.name        as product_name,
    p.brand       as product_brand,
    p.price       as product_price,
    p.image_url   as product_image_url,
    p.url         as product_url,
    p.gender      as product_gender,
    p.type        as product_type,
    pc.concept_doc,
    pc.concept_facets,
    f.rrf_score,
    f.dense_rank,
    f.bm25_rank
  from fused f
  join public.product_creative pc on pc.id = f.id
  join public.products p          on p.id  = pc.product_id
  order by f.rrf_score desc;
$$;

grant execute on function public.search_creatives_hybrid(vector, text, int, text, text[], boolean, uuid[])
  to anon, authenticated;
