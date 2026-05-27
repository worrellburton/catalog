-- Fix search_products: eliminate dense-only noise for unrelated queries.
--
-- Problem: queries with zero text relevance (e.g. "skincare" in a fashion
-- catalog) return pure dense-neighbor noise. The FULL OUTER JOIN surfaces
-- every nearest-neighbor even when no product name/brand/type/description
-- contains any query term. Dense-only scores (~0.0164) clear the 0.015
-- semantic fallback threshold, so random products appear.
--
-- Fix: gate dense-only results on category_intent. The FULL OUTER JOIN is
-- kept so that queries like "black shirts" (where BM25 fails because the
-- catalog uses "Top" not "Shirt") can still surface dense results — but
-- ONLY when a clear product-category keyword is detected in the query.
--
--   "skincare"     → no category intent, no BM25 → 0 results       ✓
--   "black shirts" → category intent = Top, no BM25 → dense Tops   ✓
--   "alo yoga"     → no category intent, has BM25 → brand results  ✓
--   "shoes"        → category intent = Shoes, has BM25 → footwear  ✓
--
-- Dense-only rows without category intent are pure nearest-neighbor noise
-- and get filtered out in the rrf CTE's WHERE clause.

drop function if exists public.search_products(vector, text, int, text, uuid[]);

create function public.search_products(
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
      ) as rk,
      ts_rank_cd(
        setweight(to_tsvector('english', coalesce(b.name, '')),        'A') ||
        setweight(to_tsvector('english', coalesce(b.brand, '')),       'B') ||
        setweight(to_tsvector('english', coalesce(b.type, '')),        'B') ||
        setweight(to_tsvector('english', coalesce(b.description, '')), 'C'),
        bm25_q.q
      ) as text_score
    from base b, bm25_q
    where (
        setweight(to_tsvector('english', coalesce(b.name, '')),        'A') ||
        setweight(to_tsvector('english', coalesce(b.brand, '')),       'B') ||
        setweight(to_tsvector('english', coalesce(b.type, '')),        'B') ||
        setweight(to_tsvector('english', coalesce(b.description, '')), 'C')
      ) @@ bm25_q.q
    limit k * 4
  ),
  -- Category intent: detect product-category keywords in query_text and
  -- map them to catalog type values. Computed before rrf so dense-only
  -- rows can be gated on whether a category was detected.
  category_intent as (
    select case
      when lower(query_text) ~* '\m(shirt|shirts|tee|tees|blouse|blouses|polo|polos|henley|henleys|button-up|button-down)\M'
        then array['Top']::text[]
      when lower(query_text) ~* '\m(short|shorts)\M'
        then array['Shorts']::text[]
      when lower(query_text) ~* '\m(pant|pants|trouser|trousers|jean|jeans|denim)\M'
        then array['Pants']::text[]
      when lower(query_text) ~* '\m(jacket|jackets|coat|coats|blazer|blazers)\M'
        then array['Jacket']::text[]
      when lower(query_text) ~* '\m(shoe|shoes|sneaker|sneakers|boot|boots|sandal|sandals|loafer|loafers)\M'
        then array['Shoes']::text[]
      when lower(query_text) ~* '\m(hat|hats|cap|caps|beanie|beanies)\M'
        then array['Hat']::text[]
      when lower(query_text) ~* '\mdresses\M'
        then array['Dress']::text[]
      when lower(query_text) ~* '\m(skirt|skirts)\M'
        then array['Skirt']::text[]
      when lower(query_text) ~* '\mdress\M'
        then array['Dress']::text[]
      else null::text[]
    end as allowed_types
  ),
  -- FULL OUTER JOIN: keep both lanes, but gate dense-only rows.
  -- Dense-only rows (b.id IS NULL) are only kept when category_intent
  -- detected a product type — otherwise they are nearest-neighbor noise.
  rrf as (
    select
      coalesce(d.id, b.id) as id,
      coalesce(1.0 / (60.0 + d.rk), 0.0) +
      coalesce(1.0 / (60.0 + b.rk), 0.0) as rrf_score
    from dense d
    full outer join bm25 b on b.id = d.id
    where b.id is not null
       or (select allowed_types from category_intent) is not null
  ),
  ranked as (
    select id, rrf_score as score
    from rrf
    where rrf_score >= case
      when (select max(text_score) from bm25) >= 0.1 then 0.020
      else 0.015
    end
    order by rrf_score desc
    limit k
  ),
  graph_boost as (
    select
      r.id,
      r.score + (
        coalesce((
          select count(*)::float * 0.002
          from public.entity_edges e
          where e.src_id = r.id
            and e.src_type = 'product'
            and e.edge_type = 'pairs_with'
            and e.dst_id in (select id from ranked)
        ), 0.0)
      ) as score
    from ranked r
  )
  select
    coalesce(c.id, p.id)                  as id,
    p.id                                   as product_id,
    c.id                                   as creative_id,
    c.id is null                           as is_placeholder,
    c.video_url,
    c.thumbnail_url,
    c.affiliate_url,
    c.duration_seconds,
    coalesce(c.is_elite, false)            as is_elite,
    p.name                                 as product_name,
    p.brand                                as product_brand,
    coalesce(p.discounted_price, p.price)  as product_price,
    p.image_url                            as product_image_url,
    p.url                                  as product_url,
    p.gender                               as product_gender,
    p.type                                 as product_type,
    gb.score
  from graph_boost gb
  join public.products p on p.id = gb.id
  cross join category_intent ci
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
  where ci.allowed_types is null
     or p.type is null
     or p.type = any(ci.allowed_types)
  order by gb.score desc;
$$;

comment on function public.search_products(vector, text, int, text, uuid[]) is
  'Search V6: dense + BM25 + RRF fusion + category intent. Dense-only rows gated on category intent (no noise for unrelated queries like "skincare"). Adaptive threshold (max text_score ≥ 0.1 → 0.020, else 0.015). Category intent post-filter. Graph connectivity bonus.';

grant execute on function public.search_products(vector, text, int, text, uuid[]) to anon, authenticated, service_role;
