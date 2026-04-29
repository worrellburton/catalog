-- 058: Embed creatives directly for semantic search.
--
-- The consumer feed only displays creatives (product_creative rows). Until now
-- nl-search embedded products + looks, then the client walked
-- look_products → products → product_creative to surface creative tiles. That
-- indirection produced wrong/empty results whenever a semantic-hit product or
-- look had no live creative, and bloated the round-trip with two extra fetches.
--
-- This migration moves the search index onto product_creative directly:
--   • concept_doc / concept_facets / text_embedding columns on product_creative
--   • search_creatives_hybrid RPC — RRF(dense, BM25) ranking over creatives,
--     joined to products for facet filters and display fields.
--
-- The visual lane (product_creative.embedding, 512-dim Marengo) is unchanged
-- and continues to serve search_creatives_visual + find_similar_creatives.
--
-- product_creative.text_embedding is 1536-dim to match the OpenAI
-- text-embedding-3-small model nl-search already uses for query embedding.

-- ── 1. Columns ──────────────────────────────────────────────────────────────

ALTER TABLE public.product_creative
  ADD COLUMN IF NOT EXISTS concept_doc    text,
  ADD COLUMN IF NOT EXISTS concept_facets jsonb,
  ADD COLUMN IF NOT EXISTS concept_at     timestamptz,
  ADD COLUMN IF NOT EXISTS text_embedding vector(1536);

COMMENT ON COLUMN public.product_creative.concept_doc    IS 'Rich semantic description of the creative (built from product + creative metadata) used as the BM25 / dense embedding source.';
COMMENT ON COLUMN public.product_creative.concept_facets IS 'Structured facets (garment_type, color_family, occasion, style_tags, formality_score) derived alongside concept_doc.';
COMMENT ON COLUMN public.product_creative.concept_at     IS 'When concept_doc was last regenerated. NULL = never embedded.';
COMMENT ON COLUMN public.product_creative.text_embedding IS 'OpenAI text-embedding-3-small (1536-dim) of concept_doc. Used by search_creatives_hybrid.';

-- ── 2. Indexes ──────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_product_creative_text_embedding_hnsw
  ON public.product_creative
  USING hnsw (text_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE text_embedding IS NOT NULL;

-- BM25 candidate index — partial GIN over the weighted tsvector source.
-- Built from concept_doc only (the joined product fields are denormalised
-- into concept_doc by embed-entity, so a single-column index is sufficient).
CREATE INDEX IF NOT EXISTS idx_product_creative_concept_doc_tsv
  ON public.product_creative
  USING gin (to_tsvector('english', coalesce(concept_doc, '')))
  WHERE concept_doc IS NOT NULL;

-- ── 3. search_creatives_hybrid ──────────────────────────────────────────────
-- RRF(dense, BM25) over product_creative, joined to products for filters and
-- display. Returns creatives in the same shape ContinuousFeed already renders
-- (CreativeCard) so the client doesn't need a hydration step.
--
-- Filters:
--   • status = 'live' AND enabled = true AND video_url IS NOT NULL
--   • product.is_active = true
--   • soft gender filter (NULL / unisex always pass)
--
-- BM25 weights pull from concept_doc (rich) + product.name/brand/type as a
-- safety net for queries hitting unembedded rows.

CREATE OR REPLACE FUNCTION public.search_creatives_hybrid(
  query_embedding vector(1536),
  query_text      text,
  k               int     DEFAULT 24,
  filter_gender   text    DEFAULT NULL,
  filter_type     text    DEFAULT NULL,
  require_elite   boolean DEFAULT FALSE
)
RETURNS TABLE(
  id                uuid,
  product_id        uuid,
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
  concept_doc       text,
  concept_facets    jsonb,
  rrf_score         double precision,
  dense_rank        bigint,
  bm25_rank         bigint
)
LANGUAGE sql STABLE
AS $$
  WITH
  candidates AS (
    SELECT pc.id, pc.product_id
    FROM public.product_creative pc
    JOIN public.products p ON p.id = pc.product_id
    WHERE pc.status = 'live'
      AND pc.enabled = true
      AND pc.video_url IS NOT NULL
      AND p.is_active = true
      AND (NOT require_elite OR pc.is_elite = true)
      AND (filter_gender IS NULL OR p.gender IS NULL OR p.gender = filter_gender OR p.gender = 'unisex')
      AND (filter_type   IS NULL OR p.type IS NULL OR p.type = filter_type)
  ),
  dense AS (
    SELECT
      c.id,
      row_number() OVER (ORDER BY pc.text_embedding <=> query_embedding) AS rk
    FROM candidates c
    JOIN public.product_creative pc ON pc.id = c.id
    WHERE pc.text_embedding IS NOT NULL
    ORDER BY pc.text_embedding <=> query_embedding
    LIMIT k * 4
  ),
  bm25 AS (
    SELECT
      c.id,
      row_number() OVER (
        ORDER BY ts_rank_cd(
          setweight(to_tsvector('english', coalesce(p.name,         '')), 'A') ||
          setweight(to_tsvector('english', coalesce(p.brand,        '')), 'B') ||
          setweight(to_tsvector('english', coalesce(p.type,         '')), 'B') ||
          setweight(to_tsvector('english', coalesce(p.description,  '')), 'C') ||
          setweight(to_tsvector('english', coalesce(pc.concept_doc, '')), 'A'),
          websearch_to_tsquery('english', query_text)
        ) DESC
      ) AS rk
    FROM candidates c
    JOIN public.product_creative pc ON pc.id = c.id
    JOIN public.products p          ON p.id  = c.product_id
    WHERE (
      setweight(to_tsvector('english', coalesce(p.name,         '')), 'A') ||
      setweight(to_tsvector('english', coalesce(p.brand,        '')), 'B') ||
      setweight(to_tsvector('english', coalesce(p.type,         '')), 'B') ||
      setweight(to_tsvector('english', coalesce(p.description,  '')), 'C') ||
      setweight(to_tsvector('english', coalesce(pc.concept_doc, '')), 'A')
    ) @@ websearch_to_tsquery('english', query_text)
    LIMIT k * 4
  ),
  fused AS (
    SELECT
      coalesce(d.id, b.id) AS id,
      coalesce(1.0 / (60.0 + d.rk), 0.0) +
      coalesce(1.0 / (60.0 + b.rk), 0.0) AS rrf_score,
      d.rk AS dense_rank,
      b.rk AS bm25_rank
    FROM dense d
    FULL OUTER JOIN bm25 b ON d.id = b.id
    ORDER BY rrf_score DESC
    LIMIT k
  )
  SELECT
    pc.id,
    pc.product_id,
    pc.video_url,
    pc.thumbnail_url,
    pc.affiliate_url,
    pc.duration_seconds,
    pc.is_elite,
    p.name        AS product_name,
    p.brand       AS product_brand,
    p.price       AS product_price,
    p.image_url   AS product_image_url,
    p.url         AS product_url,
    p.gender      AS product_gender,
    p.type        AS product_type,
    pc.concept_doc,
    pc.concept_facets,
    f.rrf_score,
    f.dense_rank,
    f.bm25_rank
  FROM fused f
  JOIN public.product_creative pc ON pc.id = f.id
  JOIN public.products p          ON p.id  = pc.product_id
  ORDER BY f.rrf_score DESC;
$$;

GRANT EXECUTE ON FUNCTION public.search_creatives_hybrid(vector, text, int, text, text, boolean)
  TO anon, authenticated;
