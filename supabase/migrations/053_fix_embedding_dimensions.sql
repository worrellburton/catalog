-- 053: Fix text_embedding dimensions for Marengo 3.0 (1024 → 512)
--
-- Marengo-retrieval-2.7 produced 1024-dim text embeddings.
-- Marengo 3.0 (successor, required since 2.7 was sunset 2026-03-30) produces
-- 512-dim embeddings for all modalities (text, visual, audio).
--
-- Changes:
--   1. Drop HNSW indexes (required before column type change)
--   2. Drop text_embedding columns on products + looks; re-add as vector(512)
--   3. Recreate HNSW indexes
--   4. Drop old RPC functions with vector(1024) signatures
--   5. Recreate search_products_hybrid and search_looks_hybrid with vector(512)

-- ── 1. Drop HNSW indexes ──────────────────────────────────────────────────────
drop index if exists public.idx_products_text_embedding_hnsw;
drop index if exists public.idx_looks_text_embedding_hnsw;

-- ── 2. Resize text_embedding columns ─────────────────────────────────────────
-- All rows are NULL (backfill has not run yet), so no data is lost.
alter table public.products drop column if exists text_embedding;
alter table public.products add column text_embedding vector(512);

alter table public.looks drop column if exists text_embedding;
alter table public.looks add column text_embedding vector(512);

-- ── 3. Recreate HNSW indexes ──────────────────────────────────────────────────
create index idx_products_text_embedding_hnsw
  on public.products using hnsw (text_embedding vector_cosine_ops)
  where text_embedding is not null;

create index idx_looks_text_embedding_hnsw
  on public.looks using hnsw (text_embedding vector_cosine_ops)
  where text_embedding is not null;

-- ── 4. Drop old 1024-dim RPC functions ────────────────────────────────────────
drop function if exists public.search_products_hybrid(vector, text, int, text, text);
drop function if exists public.search_looks_hybrid(vector, text, int);

-- ── 5a. Recreate search_products_hybrid (vector(512)) ─────────────────────────
create or replace function public.search_products_hybrid(
  query_embedding vector(512),
  query_text      text,
  k               int     default 20,
  filter_gender   text    default null,
  filter_type     text    default null
) returns table (
  id             uuid,
  entity_type    text,
  name           text,
  brand          text,
  price          text,
  image_url      text,
  description    text,
  concept_doc    text,
  concept_facets jsonb,
  gender         text,
  type           text,
  url            text,
  rrf_score      double precision,
  dense_rank     bigint,
  bm25_rank      bigint
) language sql stable as $$
  with
  dense as (
    select
      p.id,
      row_number() over (order by p.text_embedding <=> query_embedding) as rk
    from public.products p
    where p.is_active = true
      and p.text_embedding is not null
      and (filter_gender is null or p.gender is null or p.gender = filter_gender or p.gender = 'unisex')
      and (filter_type   is null or p.type = filter_type)
    order by p.text_embedding <=> query_embedding
    limit k * 4
  ),
  bm25 as (
    select
      p.id,
      row_number() over (
        order by ts_rank_cd(
          setweight(to_tsvector('english', coalesce(p.name, '')),        'A') ||
          setweight(to_tsvector('english', coalesce(p.brand, '')),       'B') ||
          setweight(to_tsvector('english', coalesce(p.type, '')),        'B') ||
          setweight(to_tsvector('english', coalesce(p.description, '')), 'C') ||
          setweight(to_tsvector('english', coalesce(p.concept_doc, '')), 'C'),
          plainto_tsquery('english', query_text)
        ) desc
      ) as rk
    from public.products p
    where p.is_active = true
      and (
        setweight(to_tsvector('english', coalesce(p.name, '')),        'A') ||
        setweight(to_tsvector('english', coalesce(p.brand, '')),       'B') ||
        setweight(to_tsvector('english', coalesce(p.type, '')),        'B') ||
        setweight(to_tsvector('english', coalesce(p.description, '')), 'C') ||
        setweight(to_tsvector('english', coalesce(p.concept_doc, '')), 'C')
      ) @@ plainto_tsquery('english', query_text)
      and (filter_gender is null or p.gender is null or p.gender = filter_gender or p.gender = 'unisex')
      and (filter_type   is null or p.type = filter_type)
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
    p.id,
    'product'::text  as entity_type,
    p.name,
    p.brand,
    p.price,
    p.image_url,
    p.description,
    p.concept_doc,
    p.concept_facets,
    p.gender,
    p.type,
    p.url,
    r.rrf_score,
    r.dense_rank,
    r.bm25_rank
  from rrf r
  join public.products p on p.id = r.id
  order by r.rrf_score desc;
$$;

grant execute on function public.search_products_hybrid(vector, text, int, text, text)
  to anon, authenticated;

-- ── 5b. Recreate search_looks_hybrid (vector(512)) ────────────────────────────
create or replace function public.search_looks_hybrid(
  query_embedding vector(512),
  query_text      text,
  k               int default 12
) returns table (
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
) language sql stable as $$
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
          setweight(to_tsvector('english', coalesce(l.title, '')),          'A') ||
          setweight(to_tsvector('english', coalesce(l.creator_handle, '')), 'B') ||
          setweight(to_tsvector('english', coalesce(l.description, '')),    'C') ||
          setweight(to_tsvector('english', coalesce(l.concept_doc, '')),    'C'),
          plainto_tsquery('english', query_text)
        ) desc
      ) as rk
    from public.looks l
    where l.status = 'live'
      and l.enabled = true
      and (
        setweight(to_tsvector('english', coalesce(l.title, '')),          'A') ||
        setweight(to_tsvector('english', coalesce(l.creator_handle, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(l.description, '')),    'C') ||
        setweight(to_tsvector('english', coalesce(l.concept_doc, '')),    'C')
      ) @@ plainto_tsquery('english', query_text)
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
    'look'::text      as entity_type,
    l.title,
    l.creator_handle,
    l.description,
    (select lv.poster_url from public.look_videos lv
       where lv.look_id = l.id order by lv.order_index asc limit 1)   as thumbnail_url,
    (select lv.url      from public.look_videos lv
       where lv.look_id = l.id order by lv.order_index asc limit 1)   as video_path,
    l.gender,
    l.concept_doc,
    l.concept_facets,
    r.rrf_score,
    r.dense_rank,
    r.bm25_rank
  from rrf r
  join public.looks l on l.id = r.id
  order by r.rrf_score desc;
$$;

grant execute on function public.search_looks_hybrid(vector, text, int)
  to anon, authenticated;
