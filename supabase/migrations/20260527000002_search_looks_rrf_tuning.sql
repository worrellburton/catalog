-- Fix search_looks RRF scoring for small corpus.
--
-- The looks table has ~20-50 rows. With RRF k=120 (tuned for the products
-- table with hundreds of rows), max possible score is 2/(120+1) = 0.0165,
-- which never clears the 0.035 threshold. Lower k to 30 and threshold to
-- 0.01 so the RRF formula produces meaningful discrimination at this scale.

drop function if exists public.search_looks(vector, text, int, text);

create or replace function public.search_looks(
  query_embedding vector(384),
  query_text      text,
  k               int  default 12,
  filter_gender   text default null
)
returns table (
  id              uuid,
  legacy_id       bigint,
  title           text,
  creator_handle  text,
  description     text,
  gender          text,
  video_url       text,
  thumbnail_url   text,
  mobile_video_url text,
  score           double precision
)
language sql stable
as $$
  with
  base as (
    select l.*
    from public.looks l
    where (l.status = 'live' or l.status is null)
      and (filter_gender is null
           or l.gender is null
           or l.gender = filter_gender
           or l.gender = 'unisex')
  ),
  dense as (
    select
      b.id,
      row_number() over (order by b.embedding <=> query_embedding) as rk
    from base b
    where b.embedding is not null
    limit k * 4
  ),
  look_product_text as (
    select
      lp.look_id,
      string_agg(coalesce(p.name, '') || ' ' || coalesce(p.brand, ''), ' ') as product_text
    from public.look_products lp
    join public.products p on p.id = lp.product_id
    group by lp.look_id
  ),
  bm25_q as (
    select plainto_tsquery('english', query_text) as q
  ),
  bm25 as (
    select
      b.id,
      row_number() over (
        order by ts_rank_cd(
          setweight(to_tsvector('english', coalesce(b.title, '')),          'A') ||
          setweight(to_tsvector('english', coalesce(b.creator_handle, '')), 'B') ||
          setweight(to_tsvector('english', coalesce(b.description, '')),    'C') ||
          setweight(to_tsvector('english', coalesce(lpt.product_text, '')), 'C'),
          bm25_q.q
        ) desc
      ) as rk
    from base b
    cross join bm25_q
    left join look_product_text lpt on lpt.look_id = b.id
    where (
        setweight(to_tsvector('english', coalesce(b.title, '')),          'A') ||
        setweight(to_tsvector('english', coalesce(b.creator_handle, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(b.description, '')),    'C') ||
        setweight(to_tsvector('english', coalesce(lpt.product_text, '')), 'C')
      ) @@ bm25_q.q
    limit k * 4
  ),
  -- Require BM25 match; dense is a ranking boost only. With ~21 looks,
  -- dense-only matches are just nearest-neighbor-of-everything noise.
  rrf as (
    select
      b.id,
      coalesce(1.0 / (30.0 + d.rk), 0.0) +
      coalesce(1.0 / (30.0 + b.rk), 0.0) as score
    from bm25 b
    left join dense d on d.id = b.id
  ),
  ranked as (
    select id, score
    from rrf
    order by score desc
    limit k
  )
  select
    l.id,
    l.legacy_id,
    l.title,
    l.creator_handle,
    l.description,
    l.gender,
    c.video_url,
    c.thumbnail_url,
    c.mobile_video_url,
    r.score
  from ranked r
  join public.looks l on l.id = r.id
  left join lateral (
    select lc.video_url, lc.thumbnail_url, lc.mobile_video_url
    from public.looks_creative lc
    where lc.look_id = l.id
      and lc.is_primary = true
      and lc.video_url is not null
    limit 1
  ) c on true
  where c.video_url is not null
  order by r.score desc;
$$;

comment on function public.search_looks(vector, text, int, text) is
  'Hybrid look search: requires BM25 text match (title + creator + description + product names), dense as ranking boost. k=30 RRF tuned for small corpus.';

grant execute on function public.search_looks(vector, text, int, text)
  to anon, authenticated, service_role;
