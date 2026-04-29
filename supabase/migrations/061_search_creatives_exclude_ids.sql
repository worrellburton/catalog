-- 061: True pagination for search_creatives_hybrid via exclude_ids.
--
-- Problem: useSemanticSearch.loadMore re-runs nl-search with k = k + PAGE_SIZE.
-- That re-runs the Claude QueryPlan, OpenAI embed, TwelveLabs embed and 4 RPC
-- calls just to discover the same top-N results plus a few new ones, which
-- the client then dedupes by id. Wasteful and slow on every scroll page.
--
-- Fix: thread an exclude_ids array into search_creatives_hybrid so each
-- subsequent page asks the DB for items NOT already shown. The candidate
-- pool is filtered before dense + BM25 ranking, so the next k results are
-- truly fresh — no client-side dedupe required and no wasted ranking work
-- on rows the client will throw away anyway.
--
-- Behaviour preserved:
--   • Default exclude_ids = '{}' so every existing caller (no arg) keeps
--     the same behaviour.
--   • Same RRF(dense + BM25) ranking, same filter semantics, same return shape.
--
-- The visual-lane RPC (search_creatives_visual) is unchanged — only the
-- text/BM25 lane is paginated; visual hits are merged client-side and
-- contribute marginal additional results once exhausted.

drop function if exists public.search_creatives_hybrid(vector, text, int, text, text, boolean);

create or replace function public.search_creatives_hybrid(
  query_embedding vector(1536),
  query_text      text,
  k               int     default 24,
  filter_gender   text    default null,
  filter_type     text    default null,
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
      and (filter_type   is null or p.type   is null or p.type   = filter_type)
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
    where (
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

grant execute on function public.search_creatives_hybrid(vector, text, int, text, text, boolean, uuid[])
  to anon, authenticated;
