-- 051: Semantic search foundation
--
-- Adds the schema substrate that powers natural-language product/look
-- retrieval with no user-side tagging. Three parallel representations per
-- entity enable hybrid retrieval (dense + lexical + visual). A search_queries
-- table with a cold-miss view closes the backfill loop.
--
-- New columns on products and looks:
--   concept_doc      text       LLM-authored semantic description (input to embedding)
--   concept_facets   jsonb      Derived facet set: garment_type, color_family[], occasion[], style_tags[], formality_score
--   concept_hash     text       SHA-256 of the inputs that produced the concept; detects stale vectors
--   concept_at       timestamptz
--   text_embedding   vector(1024) TwelveLabs Marengo-retrieval-2.7 text embedding (1024-dim) over concept_doc
--   visual_embedding vector(512)  TwelveLabs Marengo image-mode over hero image / first creative
--   embedded_at      timestamptz
--
-- New tables:
--   entity_edges     (src → dst with edge_type, weight)   outfit-pairing graph
--   search_queries   logging + cold-miss detection
--
-- New RPC:
--   log_search_query(...)   atomic upsert for edge-function logging

-- ── 0. Guard: pgvector must be installed (idempotent) ───────────────────────
create extension if not exists vector;

-- ── 1. Products ──────────────────────────────────────────────────────────────
alter table public.products
  add column if not exists concept_doc      text,
  add column if not exists concept_facets   jsonb,
  add column if not exists concept_hash     text,
  add column if not exists concept_at       timestamptz,
  add column if not exists text_embedding   vector(1024),
  add column if not exists visual_embedding vector(512),
  add column if not exists embedded_at      timestamptz;

comment on column public.products.concept_doc is
  'LLM-authored semantic description covering what the item is, who wears it, occasions, and pairing context. Embedding input.';
comment on column public.products.concept_facets is
  'Derived facet set: {garment_type, color_family[], occasion[], style_tags[], formality_score}. Populated by embed-entity. Used only as a re-rank feature — never shown to users.';
comment on column public.products.text_embedding is
  'TwelveLabs Marengo-retrieval-2.7 text embedding (1024-dim) over concept_doc. Populated by embed-entity edge function.';
comment on column public.products.visual_embedding is
  'TwelveLabs Marengo image-mode embedding (512-dim) over hero product image. Populated by embed-entity edge function.';

-- ── 2. Looks ─────────────────────────────────────────────────────────────────
alter table public.looks
  add column if not exists concept_doc      text,
  add column if not exists concept_facets   jsonb,
  add column if not exists concept_hash     text,
  add column if not exists concept_at       timestamptz,
  add column if not exists text_embedding   vector(1024),
  add column if not exists visual_embedding vector(512),
  add column if not exists embedded_at      timestamptz;

comment on column public.looks.concept_doc is
  'LLM-authored semantic description of the look: overall vibe, products in it, occasion, aesthetic. Embedding input.';
comment on column public.looks.visual_embedding is
  'Visual embedding sourced from the first available product_creative or generated_videos video via TwelveLabs Marengo. Populated by embed-entity.';

-- ── 3. HNSW indexes on text embeddings ──────────────────────────────────────
-- ef_construction=200 / m=16 are the recommended defaults for cosine ops.
-- Partial index on non-null rows means the index stays small and warm until
-- the backfill populates every row.
create index if not exists idx_products_text_embedding_hnsw
  on public.products using hnsw (text_embedding vector_cosine_ops)
  where text_embedding is not null;

create index if not exists idx_looks_text_embedding_hnsw
  on public.looks using hnsw (text_embedding vector_cosine_ops)
  where text_embedding is not null;

-- ── 4. HNSW indexes on visual embeddings ────────────────────────────────────
create index if not exists idx_products_visual_embedding_hnsw
  on public.products using hnsw (visual_embedding vector_cosine_ops)
  where visual_embedding is not null;

create index if not exists idx_looks_visual_embedding_hnsw
  on public.looks using hnsw (visual_embedding vector_cosine_ops)
  where visual_embedding is not null;

-- ── 5. Entity edges (outfit-pairing graph) ───────────────────────────────────
-- src → dst edges represent relationships like "these products are worn together"
-- or "this look and that product share the same aesthetic".
-- Populated by an offline job (look co-occurrence + LLM assertion).
-- Used by nl-search for outfit_pairing intent: "what to wear with X" walks
-- pairs_with edges from the anchor entity into the candidate pool.

create table if not exists public.entity_edges (
  id         uuid primary key default gen_random_uuid(),
  src_id     uuid not null,
  src_type   text not null check (src_type in ('product', 'look')),
  dst_id     uuid not null,
  dst_type   text not null check (dst_type in ('product', 'look')),
  edge_type  text not null check (edge_type in ('pairs_with', 'same_outfit', 'same_aesthetic', 'same_occasion')),
  weight     float not null default 1.0 check (weight > 0 and weight <= 1),
  source     text,           -- 'look_cooccurrence' | 'llm_asserted' | 'user_signal'
  created_at timestamptz default now(),
  unique (src_id, dst_id, edge_type)
);

create index if not exists idx_entity_edges_src on public.entity_edges(src_id, edge_type);
create index if not exists idx_entity_edges_dst on public.entity_edges(dst_id, edge_type);

alter table public.entity_edges enable row level security;

drop policy if exists "Public read entity_edges" on public.entity_edges;
create policy "Public read entity_edges"
  on public.entity_edges for select using (true);

drop policy if exists "Service write entity_edges" on public.entity_edges;
create policy "Service write entity_edges"
  on public.entity_edges for all using (auth.role() = 'service_role');

-- ── 6. Search queries (logging + cold-miss detection) ────────────────────────
create table if not exists public.search_queries (
  id               uuid primary key default gen_random_uuid(),
  raw_query        text not null,
  normalized_query text not null,             -- lower + trim + collapse whitespace
  query_plan       jsonb,                     -- QueryPlan JSON from nl-search
  result_count     integer not null default 0,
  top_score        float,                     -- highest RRF score in result set
  user_id          uuid references auth.users(id) on delete set null,
  session_id       text,                      -- anonymous session identifier
  backfill_status  text not null default 'none'
                     check (backfill_status in ('none', 'queued', 'processing', 'done')),
  served_count     integer not null default 1,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- Unique constraint on normalized_query lets the upsert coalesce repeated
-- searches into one row with an incrementing served_count.
create unique index if not exists idx_search_queries_normalized
  on public.search_queries(normalized_query);

create index if not exists idx_search_queries_backfill
  on public.search_queries(backfill_status)
  where backfill_status in ('none', 'queued');

create index if not exists idx_search_queries_created
  on public.search_queries(created_at desc);

alter table public.search_queries enable row level security;

-- Service role has full access for logging and backfill processing.
drop policy if exists "Service write search_queries" on public.search_queries;
create policy "Service write search_queries"
  on public.search_queries for all using (auth.role() = 'service_role');

-- Public read so the client can poll for backfill_status on its own queries.
drop policy if exists "Public read search_queries" on public.search_queries;
create policy "Public read search_queries"
  on public.search_queries for select using (true);

-- updated_at trigger (reuses the generic function if it exists)
create or replace trigger set_search_queries_updated_at
  before update on public.search_queries
  for each row execute function update_updated_at();

-- ── 7. log_search_query RPC ──────────────────────────────────────────────────
-- Atomic upsert: called by nl-search edge function after every query.
-- Same normalized query → increment served_count, update scores/plan.
-- Returns the row id so the client can subscribe to backfill_status changes.

create or replace function public.log_search_query(
  p_raw_query      text,
  p_result_count   integer,
  p_top_score      float    default null,
  p_query_plan     jsonb    default null,
  p_user_id        uuid     default null,
  p_session_id     text     default null
) returns uuid
language plpgsql
security definer
as $$
declare
  v_normalized text;
  v_id         uuid;
begin
  -- Normalize: lowercase, trim, collapse internal whitespace.
  v_normalized := lower(btrim(regexp_replace(p_raw_query, '\s+', ' ', 'g')));
  if v_normalized = '' then
    raise exception 'raw_query must not be blank';
  end if;

  insert into public.search_queries
    (raw_query, normalized_query, result_count, top_score, query_plan, user_id, session_id)
  values
    (p_raw_query, v_normalized, p_result_count, p_top_score, p_query_plan, p_user_id, p_session_id)
  on conflict (normalized_query) do update
    set served_count = public.search_queries.served_count + 1,
        result_count = excluded.result_count,
        top_score    = excluded.top_score,
        query_plan   = coalesce(excluded.query_plan, public.search_queries.query_plan),
        updated_at   = now()
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.log_search_query(text, integer, float, jsonb, uuid, text)
  to anon, authenticated;

-- ── 8. search_query_misses view ──────────────────────────────────────────────
-- Misses = queries where:
--   • result_count < 3  (almost nothing came back)
--   • OR top_score IS NULL or < 0.015  (RRF scores are in 0..0.033 range; below 0.015 = weak)
--   • AND backfill not yet started
-- The backfill agent reads this view to prioritise which gaps to fill.
-- Sorted by served_count desc so high-frequency misses go first.

drop view if exists public.search_query_misses;
create or replace view public.search_query_misses as
  select *
  from public.search_queries
  where (result_count < 3 or top_score is null or top_score < 0.015)
    and backfill_status = 'none'
  order by served_count desc, created_at desc;

grant select on public.search_query_misses to service_role;
