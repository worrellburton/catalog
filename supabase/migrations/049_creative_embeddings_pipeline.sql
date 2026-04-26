-- 049: TwelveLabs Marengo 3.0 embedding pipeline
--
-- Three changes from the original 045 design:
--   1. Marengo 3.0 outputs 512-dim vectors (not 1024 like 2.7). Resize the
--      embedding column. Safe because no rows have populated the column yet.
--   2. TwelveLabs has no completion webhook for embed-v2 tasks; we have to
--      poll. Add embedding_task_id so a row can carry the in-flight task
--      identifier between submit and poll.
--   3. Build the HNSW index (deferred in 045) and ship the
--      find_similar_creatives RPC so the consumer can ask "what looks like
--      this?" with a single Supabase call.
--
-- Trigger wiring (auto-fire embed-creative when the worker finishes a render)
-- is deliberately NOT in this migration — see follow-up after pipeline is
-- verified end-to-end on one row.

-- ── 1. Resize embedding column to 512-dim ───────────────────────────────
alter table product_creative drop column if exists embedding;
alter table product_creative add  column embedding vector(512);

comment on column product_creative.embedding is
  'TwelveLabs Marengo 3.0 visual embedding (512-dim). Populated async via the embed-creative + embed-poll edge functions.';

-- ── 2. Track in-flight TwelveLabs tasks ─────────────────────────────────
-- NULL = nothing in flight (either never submitted, or completed and cleared).
-- Set    = waiting on TwelveLabs; embed-poll will check status and either
--           write the resulting vector (and clear this) or leave it for the
--           next sweep.
alter table product_creative
  add column if not exists embedding_task_id text;

create index if not exists idx_product_creative_embedding_task
  on product_creative(embedding_task_id)
  where embedding_task_id is not null;

-- ── 3. HNSW index for cosine similarity ─────────────────────────────────
-- 512-dim vectors fit comfortably under pgvector's HNSW dimensional limit
-- (2000). Cosine ops match Marengo's training objective.
create index if not exists idx_product_creative_embedding_hnsw
  on product_creative using hnsw (embedding vector_cosine_ops);

-- ── 4. find_similar_creatives RPC ───────────────────────────────────────
-- Returns the K nearest live creatives by cosine distance, deduped to one
-- per product so the rail surfaces variety. If the seed row has no
-- embedding yet (still indexing or fallback path), drops back to "same
-- brand → newest" so the rail is never empty.
create or replace function find_similar_creatives(
  seed_id uuid,
  k       int default 12
) returns table (
  id            uuid,
  product_id    uuid,
  video_url     text,
  thumbnail_url text,
  product_name  text,
  product_brand text,
  distance      double precision
) language plpgsql stable as $$
declare
  seed_embedding vector(512);
  seed_brand     text;
begin
  select pc.embedding, p.brand
    into seed_embedding, seed_brand
    from product_creative pc
    join products p on p.id = pc.product_id
   where pc.id = seed_id;

  if seed_embedding is not null then
    return query
      select distinct on (pc.product_id)
        pc.id, pc.product_id, pc.video_url, pc.thumbnail_url,
        p.name, p.brand,
        (pc.embedding <=> seed_embedding)::double precision as distance
      from product_creative pc
      join products p on p.id = pc.product_id
      where pc.id <> seed_id
        and pc.status = 'live'
        and pc.video_url is not null
        and pc.embedding is not null
      order by pc.product_id, pc.embedding <=> seed_embedding
      limit k;
  else
    return query
      select distinct on (pc.product_id)
        pc.id, pc.product_id, pc.video_url, pc.thumbnail_url,
        p.name, p.brand,
        1.0::double precision as distance
      from product_creative pc
      join products p on p.id = pc.product_id
      where pc.id <> seed_id
        and pc.status = 'live'
        and pc.video_url is not null
        and (p.brand = seed_brand or seed_brand is null)
      order by pc.product_id, pc.created_at desc
      limit k;
  end if;
end;
$$;

grant execute on function find_similar_creatives(uuid, int) to anon, authenticated;
