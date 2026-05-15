-- 20260515000001: Knowledge Graph — pair expansion + search graph boost
--
-- Three changes:
--
--   1. Expand entity_edges with same_brand and same_type edges derived
--      from the products table, and re-run the look co-occurrence builder
--      so pairs_with edges stay current.
--
--   2. New RPC: get_graph_pairs(anchor_ids, k, edge_types)
--      Given a set of product IDs (the anchor), return active products that
--      share an explicit relationship in entity_edges. Powers the
--      "Pairs well with" rail on ProductPage. Returns the product row +
--      the edge metadata so the client can show why items were recommended.
--
--   3. Update search_products to include a graph connectivity bonus:
--      after the dense+BM25+RRF pass, products that share edges with
--      other top-ranked results receive a small bump (0.002 per connected
--      peer). This lets an outfit cluster surface together instead of
--      being scattered across the result page.
--
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1. Expand edge_type constraint + ensure indexes ──────────────────────────

-- The original constraint only allowed the four editorial types. Expand it
-- to include same_brand and same_type which are derived automatically from
-- product attributes (no editorial curation needed).
alter table public.entity_edges
  drop constraint if exists entity_edges_edge_type_check;

alter table public.entity_edges
  add constraint entity_edges_edge_type_check
  check (edge_type = any(array[
    'pairs_with', 'same_outfit', 'same_aesthetic', 'same_occasion',
    'same_brand', 'same_type'
  ]));

create index if not exists idx_entity_edges_src on public.entity_edges(src_id, edge_type);
create index if not exists idx_entity_edges_dst on public.entity_edges(dst_id, edge_type);

-- ── 2. Expand same_brand edges ───────────────────────────────────────────────
-- Weight 0.5: meaningful but lower than look co-occurrence (0–1 normalised).
-- p1.id < p2.id dedupe ensures we insert undirected edges once each direction.

insert into public.entity_edges (src_id, src_type, dst_id, dst_type, edge_type, weight, source)
select
  p1.id,
  'product',
  p2.id,
  'product',
  'same_brand',
  0.5,
  'product_attribute'
from public.products p1
join public.products p2
  on lower(trim(p1.brand)) = lower(trim(p2.brand))
  and p1.id <> p2.id
where p1.is_active = true
  and p2.is_active = true
  and p1.brand is not null
  and p1.brand <> ''
on conflict (src_id, dst_id, edge_type) do nothing;

-- ── 3. Expand same_type edges ────────────────────────────────────────────────
-- Weight 0.3: weakest signal — same product category but different brand.

insert into public.entity_edges (src_id, src_type, dst_id, dst_type, edge_type, weight, source)
select
  p1.id,
  'product',
  p2.id,
  'product',
  'same_type',
  0.3,
  'product_attribute'
from public.products p1
join public.products p2
  on lower(trim(p1.type)) = lower(trim(p2.type))
  and lower(trim(p1.brand)) <> lower(trim(p2.brand))
  and p1.id <> p2.id
where p1.is_active = true
  and p2.is_active = true
  and p1.type is not null
  and p1.type <> ''
on conflict (src_id, dst_id, edge_type) do nothing;

-- ── 4. Rebuild look co-occurrence pairs_with edges ───────────────────────────
-- Re-run the offline builder so pairs_with reflects the current look catalog.

select public.build_entity_edges_from_looks();

-- ── 5. RPC: get_graph_pairs ──────────────────────────────────────────────────
-- Returns active products connected to any of the provided anchor_ids via
-- entity_edges. Used by the "Pairs well with" rail on ProductPage.
--
-- Parameters:
--   anchor_ids  uuid[]  — product IDs to find connections for
--   k           int     — max results (default 12)
--   edge_types  text[]  — edge types to traverse (default: pairs_with only)
--
-- Returns a deduplicated set sorted by edge weight desc.
-- Excludes the anchor products themselves from results.

drop function if exists public.get_graph_pairs(uuid[], int, text[]);

create function public.get_graph_pairs(
  anchor_ids  uuid[],
  k           int    default 12,
  edge_types  text[] default array['pairs_with']
)
returns table (
  product_id    uuid,
  name          text,
  brand         text,
  price         text,
  image_url     text,
  url           text,
  type          text,
  gender        text,
  edge_type     text,
  edge_weight   float
)
language sql stable security definer
as $$
  select distinct on (p.id)
    p.id          as product_id,
    p.name,
    p.brand,
    coalesce(p.discounted_price, p.price) as price,
    p.image_url,
    p.url,
    p.type,
    p.gender,
    e.edge_type,
    e.weight      as edge_weight
  from public.entity_edges e
  join public.products p
    on p.id = e.dst_id
    and e.dst_type = 'product'
  where e.src_id = any(anchor_ids)
    and e.src_type = 'product'
    and e.edge_type = any(edge_types)
    and p.is_active = true
    and not (p.id = any(anchor_ids))
  order by p.id, e.weight desc
  limit k * 2
$$;

-- Re-sort by weight after the distinct on dedupe
create or replace function public.get_graph_pairs(
  anchor_ids  uuid[],
  k           int    default 12,
  edge_types  text[] default array['pairs_with']
)
returns table (
  product_id    uuid,
  name          text,
  brand         text,
  price         text,
  image_url     text,
  url           text,
  type          text,
  gender        text,
  edge_type     text,
  edge_weight   float
)
language sql stable security definer
as $$
  with candidates as (
    select distinct on (p.id)
      p.id          as product_id,
      p.name,
      p.brand,
      coalesce(p.discounted_price, p.price) as price,
      p.image_url,
      p.url,
      p.type,
      p.gender,
      e.edge_type,
      e.weight      as edge_weight
    from public.entity_edges e
    join public.products p
      on p.id = e.dst_id
      and e.dst_type = 'product'
    where e.src_id = any(anchor_ids)
      and e.src_type = 'product'
      and e.edge_type = any(edge_types)
      and p.is_active = true
      and not (p.id = any(anchor_ids))
    order by p.id, e.weight desc
  )
  select *
  from candidates
  order by edge_weight desc
  limit k
$$;

grant execute on function public.get_graph_pairs(uuid[], int, text[]) to anon, authenticated, service_role;

-- ── 6. Add graph connectivity boost to search_products ──────────────────────
-- Post-RRF: for each result, count how many other results in the top-k share
-- a pairs_with edge. Each connected peer adds 0.002 to the score.
-- Effect: products that are outfit-compatible with other top results
-- cluster together instead of being scattered — e.g. Nike shoes and Nike
-- socks that co-appear in looks will surface near each other.

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
  -- Strict AND BM25 for when query terms appear in product text.
  -- plainto_tsquery keeps AND semantics so only genuinely relevant
  -- text matches contribute. Dense (semantic) handles queries where
  -- text fields don't match (e.g. colour words, synonyms).
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
  -- FULL OUTER JOIN: semantic OR text match
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
    where rrf_score >= 0.015
    order by rrf_score desc
    limit k
  ),
  -- Graph connectivity bonus: count pairs_with edges between results.
  -- Each peer connection adds 0.002 to the base score.
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
  'Search V3 + graph boost: semantic (embeddings) OR text (BM25). RRF fusion with pairs_with connectivity bonus lifts outfit-compatible items into proximity.';

grant execute on function public.search_products(vector, text, int, text, uuid[]) to anon, authenticated, service_role;
