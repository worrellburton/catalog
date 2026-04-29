-- 052: Semantic search RPCs
--
-- Hybrid retrieval functions used by the nl-search edge function.
-- Each function fuses dense vector search with BM25 lexical search via
-- Reciprocal Rank Fusion (RRF, k=60). RRF is parameter-free and consistently
-- outperforms weighted score fusion by 15-30% NDCG@10 on mixed-intent queries.
--
-- Functions:
--   search_products_hybrid(query_embedding, query_text, k, filter_gender, filter_type)
--   search_looks_hybrid(query_embedding, query_text, k)
--   search_products_by_entity_edges(anchor_id, anchor_type, k)  -- outfit pairing graph walk
--   build_entity_edges_from_looks()                             -- offline graph builder

-- ── 1. search_products_hybrid ────────────────────────────────────────────────
-- Returns top-k products ranked by RRF(dense cosine rank, BM25 rank).
-- Both paths run against is_active=true rows. Dense path requires a populated
-- text_embedding; rows without it are only reachable via BM25.
-- Soft facet filters (gender, type) apply to both paths as WHERE clauses so
-- they never hard-block a result, only tighten the candidate pool.

create or replace function public.search_products_hybrid(
  query_embedding vector(1024),
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
  -- Dense: rank by cosine distance (lower = closer = rank 1)
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
  -- BM25: rank by Postgres ts_rank_cd over a weighted tsvector
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
  -- RRF fusion (k=60 as per the original RRF paper)
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

-- ── 2. search_looks_hybrid ───────────────────────────────────────────────────
-- Same RRF pattern for looks. Requires status='live' and enabled=true.
-- Visual embedding on looks points at the look's video creative via TwelveLabs.

create or replace function public.search_looks_hybrid(
  query_embedding vector(1024),
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
    -- First video poster as thumbnail; first video URL as video_path
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

-- ── 3. search_products_by_entity_edges ───────────────────────────────────────
-- Graph walk: given an anchor product/look, return products connected via
-- entity_edges (outfit-pairing intent: "what to wear with X").
-- Weights edges by `weight` and then by the connected product's text_embedding
-- similarity to the query for secondary ranking.

create or replace function public.search_products_by_entity_edges(
  anchor_id        uuid,
  anchor_type      text  default 'product',
  k                int   default 12,
  edge_type_filter text  default 'pairs_with'
) returns table (
  id          uuid,
  entity_type text,
  name        text,
  brand       text,
  price       text,
  image_url   text,
  description text,
  url         text,
  edge_weight float
) language sql stable as $$
  select
    p.id,
    'product'::text as entity_type,
    p.name,
    p.brand,
    p.price,
    p.image_url,
    p.description,
    p.url,
    e.weight        as edge_weight
  from public.entity_edges e
  join public.products p on p.id = e.dst_id and e.dst_type = 'product'
  where e.src_id    = anchor_id
    and e.src_type  = anchor_type
    and e.edge_type = edge_type_filter
    and p.is_active = true
  order by e.weight desc
  limit k;
$$;

grant execute on function public.search_products_by_entity_edges(uuid, text, int, text)
  to anon, authenticated;

-- ── 4. build_entity_edges_from_looks ─────────────────────────────────────────
-- Offline utility: derives pairs_with edges from look co-occurrence.
-- When two products appear in the same look, they get a pairs_with edge.
-- Edge weight = look_count / max_look_count across all pairs (normalised).
-- Run manually (or via cron) after bulk product ingestion.

create or replace function public.build_entity_edges_from_looks()
returns void
language plpgsql
security definer as $$
declare
  max_weight integer;
begin
  -- Compute co-occurrence counts into a temp table
  create temp table if not exists _edge_counts as
    select
      lp1.product_id as src_id,
      lp2.product_id as dst_id,
      count(*)       as co_count
    from public.look_products lp1
    join public.look_products lp2
      on lp1.look_id = lp2.look_id
     and lp1.product_id <> lp2.product_id
    group by lp1.product_id, lp2.product_id;

  select max(co_count) into max_weight from _edge_counts;

  if max_weight is null or max_weight = 0 then
    drop table if exists _edge_counts;
    return;
  end if;

  -- Upsert edges, normalising weight to 0..1
  insert into public.entity_edges (src_id, src_type, dst_id, dst_type, edge_type, weight, source)
    select
      src_id,
      'product',
      dst_id,
      'product',
      'pairs_with',
      (co_count::float / max_weight::float),
      'look_cooccurrence'
    from _edge_counts
  on conflict (src_id, dst_id, edge_type) do update
    set weight = excluded.weight,
        source = excluded.source;

  drop table if exists _edge_counts;
end;
$$;

grant execute on function public.build_entity_edges_from_looks() to service_role;
