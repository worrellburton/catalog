-- Migration 057: Switch text_embedding from TwelveLabs 512-dim to OpenAI 1536-dim
-- Drops HNSW indexes, resizes columns, updates search RPCs to match new dimensions.
-- product_creative.embedding stays 512-dim (TwelveLabs visual — used by search_creatives_visual).

-- ── 1. Drop HNSW indexes on text_embedding ────────────────────────────────
DROP INDEX IF EXISTS public.idx_products_text_embedding_hnsw;
DROP INDEX IF EXISTS public.idx_looks_text_embedding_hnsw;

-- ── 2. Resize text_embedding columns to 1536-dim ─────────────────────────
-- There is no ALTER TYPE for vector dimensions; must drop + re-add.
ALTER TABLE public.products DROP COLUMN IF EXISTS text_embedding;
ALTER TABLE public.products ADD  COLUMN text_embedding vector(1536);

ALTER TABLE public.looks DROP COLUMN IF EXISTS text_embedding;
ALTER TABLE public.looks ADD  COLUMN text_embedding vector(1536);

-- ── 3. Recreate HNSW indexes for 1536-dim ────────────────────────────────
CREATE INDEX idx_products_text_embedding_hnsw
  ON public.products
  USING hnsw (text_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE text_embedding IS NOT NULL;

CREATE INDEX idx_looks_text_embedding_hnsw
  ON public.looks
  USING hnsw (text_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE text_embedding IS NOT NULL;

-- ── 4. Update search_products_hybrid to accept vector(1536) ──────────────
DROP FUNCTION IF EXISTS public.search_products_hybrid(vector, text, int, text, text);

CREATE OR REPLACE FUNCTION public.search_products_hybrid(
  query_embedding vector(1536),
  query_text      text,
  k               int     DEFAULT 20,
  filter_gender   text    DEFAULT NULL,
  filter_type     text    DEFAULT NULL
)
RETURNS TABLE(
  id           uuid,
  entity_type  text,
  name         text,
  brand        text,
  description  text,
  image_url    text,
  price        text,
  type         text,
  gender       text,
  concept_doc  text,
  concept_facets jsonb,
  rrf_score    double precision,
  dense_rank   bigint,
  bm25_rank    bigint
)
LANGUAGE sql STABLE
AS $$
  with
  dense as (
    select
      p.id,
      row_number() over (order by p.text_embedding <=> query_embedding) as rk
    from public.products p
    where p.is_active = true
      and p.text_embedding is not null
      and (filter_gender is null or p.gender = filter_gender or p.gender = 'unisex')
      and (filter_type   is null or p.type   = filter_type)
    order by p.text_embedding <=> query_embedding
    limit k * 4
  ),
  bm25 as (
    select
      p.id,
      row_number() over (
        order by ts_rank_cd(
          setweight(to_tsvector('english', coalesce(p.name,        '')), 'A') ||
          setweight(to_tsvector('english', coalesce(p.brand,       '')), 'B') ||
          setweight(to_tsvector('english', coalesce(p.type,        '')), 'B') ||
          setweight(to_tsvector('english', coalesce(p.description, '')), 'C') ||
          setweight(to_tsvector('english', coalesce(p.concept_doc, '')), 'C'),
          websearch_to_tsquery('english', query_text)
        ) desc
      ) as rk
    from public.products p
    where p.is_active = true
      and (filter_gender is null or p.gender = filter_gender or p.gender = 'unisex')
      and (filter_type   is null or p.type   = filter_type)
      and (
        setweight(to_tsvector('english', coalesce(p.name,        '')), 'A') ||
        setweight(to_tsvector('english', coalesce(p.brand,       '')), 'B') ||
        setweight(to_tsvector('english', coalesce(p.type,        '')), 'B') ||
        setweight(to_tsvector('english', coalesce(p.description, '')), 'C') ||
        setweight(to_tsvector('english', coalesce(p.concept_doc, '')), 'C')
      ) @@ websearch_to_tsquery('english', query_text)
    limit k * 4
  ),
  rrf as (
    select
      coalesce(d.id, b.id)                                           as id,
      coalesce(1.0 / (60.0 + d.rk), 0.0) +
      coalesce(1.0 / (60.0 + b.rk), 0.0)                            as rrf_score,
      d.rk                                                           as dense_rank,
      b.rk                                                           as bm25_rank
    from dense d
    full outer join bm25 b on d.id = b.id
    order by rrf_score desc
    limit k
  )
  select
    p.id,
    'product'::text as entity_type,
    p.name, p.brand, p.description, p.image_url, p.price, p.type, p.gender,
    p.concept_doc, p.concept_facets,
    r.rrf_score, r.dense_rank, r.bm25_rank
  from rrf r
  join public.products p on p.id = r.id
  order by r.rrf_score desc;
$$;

-- ── 5. Update search_looks_hybrid to accept vector(1536) ─────────────────
DROP FUNCTION IF EXISTS public.search_looks_hybrid(vector, text, int);

CREATE OR REPLACE FUNCTION public.search_looks_hybrid(
  query_embedding vector(1536),
  query_text      text,
  k               int DEFAULT 12
)
RETURNS TABLE(
  id             uuid,
  entity_type    text,
  title          text,
  creator_handle text,
  description    text,
  thumbnail_url  text,
  video_path     text,
  gender         text,
  concept_doc    text,
  concept_facets jsonb,
  rrf_score      double precision,
  dense_rank     bigint,
  bm25_rank      bigint
)
LANGUAGE sql STABLE
AS $$
  with
  dense as (
    select
      l.id,
      row_number() over (order by l.text_embedding <=> query_embedding) as rk
    from public.looks l
    where l.status = 'live'
      and l.enabled = true
      and l.text_embedding is not null
    order by l.text_embedding <=> query_embedding
    limit k * 4
  ),
  bm25 as (
    select
      l.id,
      row_number() over (
        order by ts_rank_cd(
          setweight(to_tsvector('english', coalesce(l.title,          '')), 'A') ||
          setweight(to_tsvector('english', coalesce(l.creator_handle, '')), 'B') ||
          setweight(to_tsvector('english', coalesce(l.description,    '')), 'C') ||
          setweight(to_tsvector('english', coalesce(l.concept_doc,    '')), 'C'),
          websearch_to_tsquery('english', query_text)
        ) desc
      ) as rk
    from public.looks l
    where l.status = 'live'
      and l.enabled = true
      and (
        setweight(to_tsvector('english', coalesce(l.title,          '')), 'A') ||
        setweight(to_tsvector('english', coalesce(l.creator_handle, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(l.description,    '')), 'C') ||
        setweight(to_tsvector('english', coalesce(l.concept_doc,    '')), 'C')
      ) @@ websearch_to_tsquery('english', query_text)
    limit k * 4
  ),
  rrf as (
    select
      coalesce(d.id, b.id)                                              as id,
      coalesce(1.0 / (60.0 + d.rk), 0.0) +
      coalesce(1.0 / (60.0 + b.rk), 0.0)                               as rrf_score,
      d.rk                                                              as dense_rank,
      b.rk                                                              as bm25_rank
    from dense d
    full outer join bm25 b on d.id = b.id
    order by rrf_score desc
    limit k
  )
  select
    l.id,
    'look'::text as entity_type,
    l.title, l.creator_handle, l.description,
    (select lv.poster_url from public.look_videos lv
       where lv.look_id = l.id order by lv.order_index asc limit 1) as thumbnail_url,
    (select lv.url from public.look_videos lv
       where lv.look_id = l.id order by lv.order_index asc limit 1) as video_path,
    l.gender, l.concept_doc, l.concept_facets,
    r.rrf_score, r.dense_rank, r.bm25_rank
  from rrf r
  join public.looks l on l.id = r.id
  order by r.rrf_score desc;
$$;
