-- 20260518000001: Search — BM25 strength-based adaptive threshold
--
-- Problem with the previous adaptive threshold
-- (case when exists(select 1 from bm25) then 0.020 else 0.015):
--
--   The gate fires whenever ANY text match exists, even a weak partial one
--   (e.g. a bag whose description contains the word "black" when the user
--   queries "black tee"). That lets in false positives: the bag scores
--   1/61 ≈ 0.0164 on BM25 rank 1 + 0 dense = 0.0164, which passes 0.020? No —
--   actually a rank-1 BM25-only item scores 0.0164 and is below 0.020.
--   BUT a rank-1 BM25 + rank-40 dense item scores 0.0164 + 0.0097 = 0.026 and
--   DOES pass 0.020, even though the dense signal says the item is
--   semantically unrelated (rank 40 out of k*4 = 96 candidates).
--
-- Fix: replace the exists() gate with a max(text_score) gate.
--
--   text_score is ts_rank_cd over the weighted tsvector (name=A, brand=B,
--   type=B, description=C). For a product whose name/brand/type contains the
--   query terms, ts_rank_cd typically returns 0.1–0.6. For a product where
--   only the description partially matches, it typically returns 0.01–0.06.
--
--   Threshold 0.1 means: "at least one product has the query terms
--   prominently in its name, brand, or type — not just buried in a
--   description". Only then do we raise the RRF threshold to 0.020
--   (AND-like semantics). Otherwise fall back to 0.015 so semantic-only
--   queries still return results.
--
-- Examples:
--   "t shirt"       → many products with "t-shirt" in name → max ≥ 0.1
--                     → threshold 0.020 (strict — only real t-shirts pass)
--
--   "black tee"     → "tee" in name of several products → max ≥ 0.1
--                     → threshold 0.020
--
--   "casual summer" → no products literally named "casual summer"
--                     → max text_score 0.02–0.06
--                     → threshold 0.015 (semantic fallback surfaces tops/linen)
--
--   "alo yoga shorts" → "shorts" in name → max ≥ 0.1 → threshold 0.020
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
      -- Capture the actual text relevance score so the threshold gate
      -- can distinguish "query terms in product name" from "query terms
      -- buried in a description" — the key signal for deciding whether
      -- to enforce AND-like search or fall back to semantic-only.
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
      -- Strong BM25: query terms appear prominently in product name/brand/type
      -- (max text_score ≥ 0.1). Raise threshold to enforce AND-like semantics:
      -- only items with BOTH good text AND good semantic signal pass.
      when (select max(text_score) from bm25) >= 0.1 then 0.020
      -- Weak or no BM25: terms not in any name/brand/type. Fall back to
      -- semantic-only so contextual queries ("casual summer") still return
      -- the most relevant tops/linen items.
      else 0.015
    end
    order by rrf_score desc
    limit k
  ),
  -- Graph connectivity bonus: products that co-appear in editorial looks
  -- alongside other top-k results get a small lift (+0.002 per peer).
  -- Effect: outfit-compatible items cluster together in results.
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
  order by gb.score desc;
$$;

comment on function public.search_products(vector, text, int, text, uuid[]) is
  'Search V4: dense + BM25 + RRF fusion. Adaptive threshold driven by max BM25 text_score: if query terms appear prominently in product name/brand/type (≥0.1), enforce 0.020 (AND-like, filters semantic drift); otherwise fall back to 0.015 (semantic-only, handles contextual queries). Graph connectivity bonus clusters outfit-compatible results.';

grant execute on function public.search_products(vector, text, int, text, uuid[]) to anon, authenticated, service_role;
