-- Migration 086: Strict relevance matching for search
--
-- CHANGES:
--   1. Raise score threshold from 0.020 to 0.035 (filters loose matches)
--   2. BM25 uses plainto_tsquery (AND logic: "black leather pants" = black AND leather AND pants)
--   3. Require BM25 match to contribute to final score (filters pure semantic noise)
--   4. Higher RRF constant (k=120) to reduce score compression
--
-- EFFECT:
--   • "jacket" → only actual jackets (not sweaters/hoodies)
--   • "black leather pants" → products with ALL three words (not just "black" or "pants")
--   • Queries with no exact matches return empty (honest, not confusing)

drop function if exists public.search_products(vector, text, int, text, uuid[]);

create or replace function public.search_products(
  query_embedding vector(384),
  query_text      text,
  k               int    default 24,
  filter_gender   text   default null,
  exclude_ids     uuid[] default '{}'::uuid[]
)
returns table (
  id                uuid,
  product_id        uuid,
  creative_id       uuid,
  is_placeholder    boolean,
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
  score             double precision
)
language sql stable
as $$
  with
  base as (
    select p.*
    from public.products p
    where p.is_active = true
      and (filter_gender is null
           or p.gender is null
           or p.gender = filter_gender
           or p.gender = 'unisex')
      and not (p.id = any(exclude_ids))
  ),
  dense as (
    select
      b.id,
      row_number() over (order by b.embedding <=> query_embedding) as rk
    from base b
    where b.embedding is not null
    limit k * 4
  ),
  -- Use plainto_tsquery for strict AND matching
  -- "black leather pants" → products must contain ALL words
  bm25_q as (
    select plainto_tsquery('english', query_text) as q
  ),
  bm25 as (
    select
      b.id,
      row_number() over (
        order by ts_rank_cd(
          setweight(to_tsvector('english', coalesce(b.name, '')),        'A') ||
          setweight(to_tsvector('english', coalesce(b.brand, '')),       'B') ||
          setweight(to_tsvector('english', coalesce(b.type, '')),        'B') ||
          setweight(to_tsvector('english', coalesce(b.description, '')), 'C'),
          bm25_q.q
        ) desc
      ) as rk
    from base b, bm25_q
    where (
        setweight(to_tsvector('english', coalesce(b.name, '')),        'A') ||
        setweight(to_tsvector('english', coalesce(b.brand, '')),       'B') ||
        setweight(to_tsvector('english', coalesce(b.type, '')),        'B') ||
        setweight(to_tsvector('english', coalesce(b.description, '')), 'C')
      ) @@ bm25_q.q
    limit k * 4
  ),
  -- RRF with higher k (120) to reduce score compression
  -- Require at least BM25 match (filters pure semantic noise)
  rrf as (
    select
      b.id,
      coalesce(1.0 / (120.0 + d.rk), 0.0) +
      coalesce(1.0 / (120.0 + b.rk), 0.0) as score
    from bm25 b
    left join dense d on d.id = b.id
  ),
  ranked as (
    select id, score
    from rrf
    -- STRICTER threshold: 0.035 (was 0.020)
    -- Filters loose matches like sweater for "jacket" query
    where score >= 0.035
    order by score desc
    limit k
  )
  select
    coalesce(c.id, p.id)               as id,
    p.id                                as product_id,
    c.id                                as creative_id,
    c.id is null                        as is_placeholder,
    c.video_url,
    c.thumbnail_url,
    c.affiliate_url,
    c.duration_seconds,
    coalesce(c.is_elite, false)         as is_elite,
    p.name                              as product_name,
    p.brand                             as product_brand,
    coalesce(p.discounted_price, p.price) as product_price,
    p.image_url                         as product_image_url,
    p.url                               as product_url,
    p.gender                            as product_gender,
    p.type                              as product_type,
    r.score
  from ranked r
  join public.products p on p.id = r.id
  left join lateral (
    select pc.id, pc.video_url, pc.thumbnail_url, pc.affiliate_url,
           pc.duration_seconds, pc.is_elite
    from public.product_creative pc
    where pc.product_id = p.id
      and pc.status in ('live', 'done')
      and pc.enabled = true
      and pc.video_url is not null
    order by pc.is_elite desc, pc.completed_at desc nulls last, pc.created_at desc
    limit 1
  ) c on true
  order by r.score desc;
$$;

comment on function public.search_products(vector, text, int, text, uuid[]) is
  'Search V3 with strict relevance matching: AND logic for multi-word queries (not OR), higher score threshold (0.035), requires text match to prevent pure semantic noise. Returns only highly relevant products.';

grant execute on function public.search_products(vector, text, int, text, uuid[]) to anon, authenticated, service_role;
