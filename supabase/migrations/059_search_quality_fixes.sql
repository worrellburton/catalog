-- 059_search_quality_fixes.sql
--
-- Two changes:
--
--  1. Lower the BM25 weight on product_creative.concept_doc from 'A' to 'B'.
--     Concept docs are model-generated prose and tend to be longer than the
--     product name. Giving them the same top weight as the name lets a single
--     stray phrase in a concept doc (e.g. "summer outfit" injected into a bra
--     creative) outrank actual product-name matches. Demoting them to weight
--     'B' keeps them as a useful signal but stops them from drowning the
--     authoritative product fields.
--
--  2. Drop the legacy product- and look-only hybrid RPCs. The consumer feed
--     and search are now creative-first; nothing reads from
--     search_products_hybrid or search_looks_hybrid any more, and leaving
--     them around would re-introduce the embedding/storage cost of
--     concept_doc + text_embedding on the products and looks tables.

-- ── 1. Recreate search_creatives_hybrid with concept_doc weight 'B' ─────────

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
          setweight(to_tsvector('english', coalesce(pc.concept_doc, '')), 'B'),
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
      setweight(to_tsvector('english', coalesce(pc.concept_doc, '')), 'B')
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

-- ── 2. Drop legacy product / look hybrid RPCs ──────────────────────────────
-- Signatures established by migration 057 (vector(1536), text, int, text [, text]).

DROP FUNCTION IF EXISTS public.search_products_hybrid(vector, text, int, text, text);
DROP FUNCTION IF EXISTS public.search_looks_hybrid(vector, text, int);
