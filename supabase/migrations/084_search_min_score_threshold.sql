-- Migration 084: Add minimum score threshold to search_products
--
-- CHANGE: Filter out low-confidence results (score < 0.020) to prevent
-- showing unrelated products when no good matches exist.
--
-- RATIONALE:
--   • "shoes" query → shoe product scores 0.0328 (good match)
--   • "sunglasses" query → random items score 0.0164 (bad match)
--   • Threshold at 0.020 filters noise while keeping real matches
--
-- EFFECT: Queries with no relevant products return empty results instead
-- of confusing users with unrelated items.

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
  bm25_q as (
    select websearch_to_tsquery('english', query_text) as q
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
  rrf as (
    select
      coalesce(d.id, b.id) as id,
      coalesce(1.0 / (60.0 + d.rk), 0.0) +
      coalesce(1.0 / (60.0 + b.rk), 0.0) as score
    from dense d
    full outer join bm25 b on b.id = d.id
  ),
  ranked as (
    select id, score
    from rrf
    -- NEW: Filter out low-confidence matches (unrelated products)
    -- Score threshold tuned based on smoke tests:
    --   • Good match (shoes → shoe): 0.0328
    --   • Bad match (sunglasses → random): 0.0164
    --   • Threshold: 0.020 (filters noise, keeps real matches)
    where score >= 0.020
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
  'Search V3 with minimum score threshold (0.020): filters out unrelated products when no good matches exist. Returns empty result set instead of confusing users with random items.';

grant execute on function public.search_products(vector, text, int, text, uuid[]) to anon, authenticated, service_role;
