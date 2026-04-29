-- 055: search_creatives_visual RPC
--
-- Phase 2 of the search overhaul: when a query has visual intent
-- ("dress for red carpet", "pair with blue jeans", "what to wear with X"),
-- nl-search will embed the query text via TwelveLabs Marengo 3.0 (same model
-- that produced product_creative.embedding) and call this RPC. Marengo
-- supports cross-modal text→video matching natively.
--
-- Returns top-k unique products whose creative video best matches the query.
-- Dedupes per product so the result set isn't dominated by one product with
-- many creatives. Joins back to products and returns the same shape as
-- search_products_hybrid so the edge function can fold results into the
-- existing RRF fusion without special-casing.

create or replace function public.search_creatives_visual(
  query_embedding vector(512),
  k               int     default 12,
  filter_gender   text    default null
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
  bm25_rank      bigint,
  creative_id    uuid,
  creative_video_url text,
  creative_thumbnail_url text
) language sql stable as $$
  with ranked as (
    select distinct on (pc.product_id)
      pc.id            as creative_id,
      pc.product_id,
      pc.video_url     as creative_video_url,
      pc.thumbnail_url as creative_thumbnail_url,
      (pc.embedding <=> query_embedding) as distance
    from public.product_creative pc
    join public.products p on p.id = pc.product_id
    where pc.embedding is not null
      and pc.status   = 'live'
      and pc.enabled  = true
      and p.is_active = true
      and (filter_gender is null or p.gender is null or p.gender = filter_gender or p.gender = 'unisex')
    order by pc.product_id, pc.embedding <=> query_embedding
  ),
  topk as (
    select
      *,
      row_number() over (order by distance asc) as rk
    from ranked
    order by distance asc
    limit k
  )
  select
    p.id,
    'product'::text as entity_type,
    p.name, p.brand, p.price, p.image_url, p.description,
    p.concept_doc, p.concept_facets, p.gender, p.type, p.url,
    -- Inverse cosine distance, normalized into the same 0..0.033 range as
    -- the RRF scores from the hybrid RPCs so the edge function's RRF fusion
    -- treats this lane comparably.
    (1.0 / (60.0 + topk.rk))::double precision as rrf_score,
    topk.rk as dense_rank,
    null::bigint as bm25_rank,
    topk.creative_id,
    topk.creative_video_url,
    topk.creative_thumbnail_url
  from topk
  join public.products p on p.id = topk.product_id
  order by topk.rk asc;
$$;

grant execute on function public.search_creatives_visual(vector, int, text)
  to anon, authenticated;
