-- 20260518000002: Search — Category intent filter
--
-- Problem diagnosed in previous session:
--   "black shirts" → BM25 AND query requires BOTH "black" AND "shirt" to
--   appear in the same product. No catalog product has "shirt" in its type
--   (all shirt-like items are typed "Top"). Result: 0 BM25 matches →
--   max(text_score) = NULL → threshold falls to 0.015 → pure-dense items
--   (score ≈ 0.0164) pass freely → Game Time Short (Shorts) and Breezy
--   Tennis Dress (Dress) appear in "black shirts" results.
--
-- Root cause: the threshold gate only controls score cutoff; it cannot
-- prevent semantically-adjacent-but-wrong-category items from passing when
-- the dense channel has no category awareness.
--
-- Fix: category intent detection via regex on query_text.
--
--   A new CTE `category_intent` checks whether the query contains a clear
--   product-category keyword (shirt, tee, shorts, pants, dress, etc.) and,
--   if so, maps it to the actual `type` values used in the catalog.
--
--   A post-filter on the final product join then enforces that only
--   matching types are returned. Products with NULL type are never excluded
--   (they pass through regardless of category detection).
--
-- Ordering note: CASE branches are ordered so compound terms work correctly:
--   • "dress shirt" → matches "shirt" branch first → ['Top'] ✓
--   • "dress pants" → matches "pant" branch first → ['Pants'] ✓
--   • "red dress"   → no shirt/pant/jacket/shoe/hat match → ['Dress'] ✓
--
-- Current catalog types: Top, Shorts, Pants, Jacket, Hat, Dress, Other,
-- Underwear, Shoes, Book, Skirt, Decor.
--
-- ────────────────────────────────────────────────────────────────────────────

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
  -- FULL OUTER JOIN: surface results via semantic OR text signal
  rrf as (
    select
      coalesce(d.id, b.id) as id,
      coalesce(1.0 / (60.0 + d.rk), 0.0) +
      coalesce(1.0 / (60.0 + b.rk), 0.0) as rrf_score
    from dense d
    full outer join bm25 b on b.id = d.id
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
  -- Graph connectivity bonus: products that co-appear in editorial looks
  -- alongside other top-k results get a small lift (+0.002 per peer).
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
  ),
  -- Category intent: detect product-category keywords in query_text and
  -- map them to the catalog's actual type values.
  -- CASE branch order matters — put compound-noun-friendly terms first so
  -- "dress shirt" → Top and "dress pants" → Pants, not Dress.
  -- NULL means no category detected → no type filter applied.
  category_intent as (
    select case
      -- Tops / shirts: must come before "dress" so "dress shirt" → Top
      when lower(query_text) ~* '\m(shirt|shirts|tee|tees|blouse|blouses|polo|polos|henley|henleys|button-up|button-down)\M'
        then array['Top']::text[]
      -- Bottoms: must come before "dress" so "dress pants" → Pants
      when lower(query_text) ~* '\m(short|shorts)\M'
        then array['Shorts']::text[]
      when lower(query_text) ~* '\m(pant|pants|trouser|trousers|jean|jeans|denim)\M'
        then array['Pants']::text[]
      -- Outerwear
      when lower(query_text) ~* '\m(jacket|jackets|coat|coats|blazer|blazers)\M'
        then array['Jacket']::text[]
      -- Footwear
      when lower(query_text) ~* '\m(shoe|shoes|sneaker|sneakers|boot|boots|sandal|sandals|loafer|loafers)\M'
        then array['Shoes']::text[]
      -- Headwear
      when lower(query_text) ~* '\m(hat|hats|cap|caps|beanie|beanies)\M'
        then array['Hat']::text[]
      -- Dresses and skirts — checked after "dress pants" / "dress shirt" ambiguity
      when lower(query_text) ~* '\mdresses\M'
        then array['Dress']::text[]
      when lower(query_text) ~* '\m(skirt|skirts)\M'
        then array['Skirt']::text[]
      -- Singular "dress" — only match if not preceded by another category
      -- (handled by CASE ordering: shirt/pant branches fire first above)
      when lower(query_text) ~* '\mdress\M'
        then array['Dress']::text[]
      else null::text[]
    end as allowed_types
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
  -- Category intent filter: when a clear product-category keyword is
  -- detected, only return products whose type matches that category.
  -- Products with NULL type always pass through (never filtered out).
  where ci.allowed_types is null
     or p.type is null
     or p.type = any(ci.allowed_types)
  order by gb.score desc;
$$;

comment on function public.search_products(vector, text, int, text, uuid[]) is
  'Search V5: dense + BM25 + RRF fusion + category intent filter. Adaptive threshold (max BM25 text_score ≥ 0.1 → 0.020 strict, else 0.015 semantic). Category intent CTE detects product-type keywords in query_text and post-filters results by catalog type, preventing cross-category drift (e.g. "black shirts" no longer returns shorts or dresses). Graph connectivity bonus clusters outfit-compatible results.';

grant execute on function public.search_products(vector, text, int, text, uuid[]) to anon, authenticated, service_role;
