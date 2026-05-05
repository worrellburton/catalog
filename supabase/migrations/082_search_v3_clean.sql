-- 082_search_v3_clean.sql
-- ============================================================================
-- Search V3 — clean rewrite.
--
--   • Embedding: Supabase.ai gte-small (384-dim), runs in-edge, no API key.
--   • Primary index: products (every active product is searchable on day 1).
--   • Hybrid retrieval: dense (cosine) ⨯ BM25 → RRF fusion.
--   • One result type: a "search hit" hydrated with the best live creative
--     when one exists, or returned as a product-only placeholder otherwise.
--
-- This migration deletes EVERY artifact of the old search stack:
--   • Old RPCs (search_creatives_hybrid, search_products_hybrid,
--     search_looks_hybrid, search_looks_to_products).
--   • Old columns (concept_doc / concept_facets / facet_text / text_embedding
--     / visual_embedding-on-products / visual_embedding-on-looks /
--     concept_at / concept_hash on the search-side tables).
--   • Old triggers + helper functions (notify_embed_creative,
--     notify_embed_look, infer_product_category, products_set_category).
--   • Caching tables / views (query_embeddings, search_query_misses).
--   • Cron job (search_backfill_nightly).
--
-- KEPT (separate concerns, not consumer search):
--   • product_creative.embedding (vector(512), TwelveLabs Marengo).
--   • find_similar_creatives RPC ("more like this" rail).
--   • embed-creative / embed-poll edge functions (visual lane).
-- ============================================================================

-- ── 1. Drop old search artifacts ────────────────────────────────────────────

-- Cron
do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'search_backfill_nightly';
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
exception when undefined_table then null;
end $$;

-- RPCs (every signature variant the codebase has shipped)
drop function if exists public.search_creatives_hybrid(vector, text, int, text, text, uuid[], boolean, int);
drop function if exists public.search_creatives_hybrid(vector, text, int, text, text[], text, uuid[], boolean, int);
drop function if exists public.search_products_hybrid(vector, text, int, text, text, uuid[], int);
drop function if exists public.search_products_hybrid(vector, text, int, text, text[], text, uuid[], int);
drop function if exists public.search_looks_hybrid(vector, text, int, text, uuid[], int);
drop function if exists public.search_looks_to_products(vector, text, int, text, uuid[]);
drop function if exists public.search_creatives_visual(vector, int, text);

-- Triggers + helper functions
drop trigger if exists trg_product_creative_auto_embed         on public.product_creative;
drop trigger if exists trg_looks_creative_auto_embed           on public.looks_creative;
drop trigger if exists trg_products_set_category               on public.products;
drop trigger if exists trg_products_invalidate_creative_concepts on public.products;
drop function if exists public.notify_embed_creative();
drop function if exists public.notify_embed_look();
drop function if exists public.products_set_category();
drop function if exists public.products_invalidate_creative_concepts();
drop function if exists public.infer_product_category(text, text, text, text);

-- Caching tables / views / canonical-types view + taxonomy table
drop view  if exists public.search_query_misses;
drop view  if exists public.product_types_canonical;
drop table if exists public.query_embeddings;
drop table if exists public.product_taxonomy;
drop table if exists public.search_backfill_attempts;

-- Old text_embedding indexes (the columns themselves get dropped below)
drop index if exists public.idx_products_text_embedding_hnsw;
drop index if exists public.idx_products_visual_embedding_hnsw;
drop index if exists public.idx_looks_text_embedding_hnsw;
drop index if exists public.idx_looks_visual_embedding_hnsw;
drop index if exists public.idx_product_creative_text_embedding_hnsw;
drop index if exists public.idx_product_creative_concept_doc_tsv;

-- ── 2. Drop old columns (clean slate per user) ──────────────────────────────

alter table public.products
  drop column if exists text_embedding,
  drop column if exists visual_embedding,
  drop column if exists concept_doc,
  drop column if exists concept_facets,
  drop column if exists concept_hash,
  drop column if exists concept_at,
  drop column if exists facet_text,
  drop column if exists category;

alter table public.product_creative
  drop column if exists text_embedding,
  drop column if exists concept_doc,
  drop column if exists concept_facets,
  drop column if exists concept_at,
  drop column if exists facet_text;

alter table public.looks
  drop column if exists text_embedding,
  drop column if exists visual_embedding,
  drop column if exists concept_doc,
  drop column if exists concept_facets,
  drop column if exists concept_hash,
  drop column if exists concept_at,
  drop column if exists facet_text;

-- ── 3. New embedding columns (gte-small = 384-dim) ──────────────────────────

alter table public.products
  add column if not exists embedding    vector(384),
  add column if not exists embedded_at  timestamptz;

comment on column public.products.embedding   is 'Supabase.ai gte-small (384-dim) embedding of name + brand + type + description. Used by search_products RPC.';
comment on column public.products.embedded_at is 'When embedding was last (re)computed. NULL = never embedded.';

-- ── 4. Indexes ──────────────────────────────────────────────────────────────

-- Dense lane
create index if not exists idx_products_embedding_hnsw
  on public.products using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64)
  where embedding is not null;

-- BM25 lane: weighted tsvector over name(A) + brand(B) + type(B) + description(C).
-- Stored as an immutable expression index — Postgres uses it for both
-- tsvector ranking and the @@ filter inside search_products.
create index if not exists idx_products_search_tsv
  on public.products
  using gin ((
    setweight(to_tsvector('english', coalesce(name, '')),        'A') ||
    setweight(to_tsvector('english', coalesce(brand, '')),       'B') ||
    setweight(to_tsvector('english', coalesce(type, '')),        'B') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C')
  ))
  where is_active = true;

-- ── 5. search_products RPC ──────────────────────────────────────────────────
-- Single entry-point. Dense + BM25 + RRF over products. LATERAL-joins each
-- match to its best live creative so the client renders one card per hit.
--
-- Behaviour:
--   • Query with both lanes when query_embedding is provided AND query_text
--     is non-empty. RRF fuses ranks (k=60 per the original paper).
--   • Single-lane fallback: when only one lane has rows, that lane wins.
--   • Soft gender filter — NULL / 'unisex' always pass.
--   • Hard exclude_ids by product_id (used for paginated loadMore).
--   • Per-product dedup is implicit: the candidate pool is products, not
--     creatives, so every result is already unique by product_id.
--   • Creative hydration: prefer is_elite, then most recent. NULLs returned
--     when no live creative exists yet — client renders the product image.

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
      and (exclude_ids is null
           or array_length(exclude_ids, 1) is null
           or p.id <> all(exclude_ids))
  ),
  dense as (
    select b.id, row_number() over (order by b.embedding <=> query_embedding) as rk
    from base b
    where query_embedding is not null
      and b.embedding is not null
    order by b.embedding <=> query_embedding
    limit k * 4
  ),
  bm25_q as (
    select case
      when coalesce(trim(query_text), '') = '' then null
      else websearch_to_tsquery('english', query_text)
    end as q
  ),
  bm25 as (
    select b.id,
      row_number() over (
        order by ts_rank_cd(
          setweight(to_tsvector('english', coalesce(b.name, '')),        'A') ||
          setweight(to_tsvector('english', coalesce(b.brand, '')),       'B') ||
          setweight(to_tsvector('english', coalesce(b.type, '')),        'B') ||
          setweight(to_tsvector('english', coalesce(b.description, '')), 'C'),
          (select q from bm25_q)
        ) desc
      ) as rk
    from base b, bm25_q
    where bm25_q.q is not null
      and (
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
  'Search V3 entry point: hybrid (dense + BM25 + RRF) over products, hydrated with the best live creative per product. Placeholder rows returned when no live creative exists.';

grant execute on function public.search_products(vector, text, int, text, uuid[]) to anon, authenticated, service_role;

-- ── 6. Auto-embed trigger on products ───────────────────────────────────────
-- Fires the embed-product edge function whenever a product's searchable text
-- changes (or it's freshly inserted). Vault secret 'embed_entity_service_key'
-- already exists from migration 060 — we reuse it.

create or replace function public.notify_embed_product()
returns trigger
language plpgsql
security definer
as $$
declare
  v_token text;
begin
  if NEW.is_active is not true then return NEW; end if;
  if NEW.name is null then return NEW; end if;

  select decrypted_secret into v_token
    from vault.decrypted_secrets
   where name = 'embed_entity_service_key'
   limit 1;

  if v_token is null or v_token = 'PLACEHOLDER_REPLACE_VIA_DASHBOARD' then
    return NEW;
  end if;

  perform net.http_post(
    url     := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/embed-product',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_token
    ),
    body    := jsonb_build_object('id', NEW.id)
  );
  return NEW;
end;
$$;

comment on function public.notify_embed_product() is
  'Fires embed-product whenever an active products row is inserted/updated and the searchable text fields change.';

drop trigger if exists trg_products_auto_embed on public.products;

create trigger trg_products_auto_embed
  after insert or update of name, brand, type, description, is_active
  on public.products
  for each row
  execute function public.notify_embed_product();

-- ── 7. Drop search_queries embedding column if present ──────────────────────
-- Keep the table for analytics, but it doesn't need to cache query embeddings
-- now that gte-small runs in-edge for free.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'search_queries' and column_name = 'embedding') then
    execute 'alter table public.search_queries drop column embedding';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'search_queries' and column_name = 'query_plan') then
    execute 'alter table public.search_queries drop column query_plan';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'search_queries' and column_name = 'backfill_status') then
    execute 'alter table public.search_queries drop column backfill_status';
  end if;
end $$;
