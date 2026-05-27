-- Migration: Add look search infrastructure (embedding + search_looks RPC)
--
-- Adds the same 384-dim gte-small embedding pattern used by products (082)
-- to the looks table, so the search edge function can query both in parallel.
--
-- Components:
--   1. embedding + embedded_at columns on looks
--   2. HNSW index on looks.embedding for the dense retrieval lane
--   3. search_looks RPC (dense + BM25 + RRF, matching search_products 086 style)
--   4. notify_embed_look trigger → calls embed-look edge function
--
-- BM25 lane indexes: title(A) + creator_handle(B) + description(C) + aggregated
-- product names from look_products (C). This means searching "nike shoes" matches
-- looks that contain Nike shoes as products.

-- ── 1. Embedding columns ───────────────────────────────────────────────────
alter table public.looks
  add column if not exists embedding    vector(384),
  add column if not exists embedded_at  timestamptz;

comment on column public.looks.embedding   is 'Supabase.ai gte-small (384-dim) embedding of title + creator + description + product names. Used by search_looks RPC.';
comment on column public.looks.embedded_at is 'When the embedding was last (re)computed.';

-- ── 2. HNSW index for dense retrieval ──────────────────────────────────────
create index if not exists idx_looks_embedding_hnsw
  on public.looks using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 100);

-- ── 3. search_looks RPC ────────────────────────────────────────────────────
-- Mirrors search_products (086) — plainto_tsquery AND logic, RRF k=120,
-- threshold 0.035. Returns look metadata + primary creative video/thumbnail.
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
  -- Build a tsvector that includes the look's own text fields PLUS the names
  -- of all products in the look (via look_products). This way "nike shoes"
  -- matches a look containing Nike Air Force 1s.
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
    where score >= 0.035
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
  'Hybrid look search: BM25 (AND logic over title + creator + description + product names) + dense (gte-small 384-dim) + RRF. Strict matching (threshold 0.035) consistent with search_products.';

grant execute on function public.search_looks(vector, text, int, text)
  to anon, authenticated, service_role;

-- ── 4. Auto-embed trigger ──────────────────────────────────────────────────
create or replace function public.notify_embed_look()
returns trigger
language plpgsql
security definer
as $$
declare
  v_token text;
begin
  if NEW.status is not null and NEW.status <> 'live' then return NEW; end if;
  if NEW.title is null then return NEW; end if;

  select decrypted_secret into v_token
    from vault.decrypted_secrets
   where name = 'embed_entity_service_key'
   limit 1;

  if v_token is null or v_token = 'PLACEHOLDER_REPLACE_VIA_DASHBOARD' then
    return NEW;
  end if;

  perform net.http_post(
    url     := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/embed-look',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_token
    ),
    body    := jsonb_build_object('id', NEW.id)
  );
  return NEW;
end;
$$;

comment on function public.notify_embed_look() is
  'Fires embed-look whenever a live looks row is inserted/updated and searchable text fields change.';

drop trigger if exists trg_looks_auto_embed on public.looks;

create trigger trg_looks_auto_embed
  after insert or update of title, creator_handle, description, status
  on public.looks
  for each row
  execute function public.notify_embed_look();
