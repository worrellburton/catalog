-- Search V7 (SHADOW) — structured facet routing.
--
-- This is an ADDITIVE shadow function. It does NOT modify the live
-- search_products (V6.1) — production is untouched until the edge function is
-- explicitly pointed at v7. Purpose: A/B the "query understanding + structured
-- filter" approach against the live ranking.
--
-- Routing:
--   * CATEGORY query (a product-type noun is detected, e.g. "white shoes",
--     "black jacket") -> STRUCTURED PATH: hard-filter candidates to that
--     category (type column OR taxonomy.category), then tier by color match
--     (exact color-family first, other colors backfill), with a residual BM25
--     text score over occasion/style text for modifiers ("running", "summer")
--     and conversion_score as the final tiebreak. The embedding is unused on
--     this path — concrete queries don't need it. Cross-category leakage is
--     impossible because non-category rows are filtered out, not just demoted.
--   * VIBE / open query (no product-type noun) -> HYBRID PATH: the existing
--     V6.1 logic, verbatim (BM25 over occasion text + dense RRF). Unchanged, so
--     "date night" / "quiet luxury" behave exactly as today.
--
-- Phase 1 scope: category + color facets. Material/price/brand facets and a
-- reranker are later phases.

create or replace function public.search_products_v7(
  query_embedding vector(384), query_text text, k integer default 24,
  filter_gender text default null, exclude_ids uuid[] default '{}'::uuid[]
)
returns table(id uuid, product_id uuid, creative_id uuid, is_placeholder boolean, video_url text,
  thumbnail_url text, affiliate_url text, duration_seconds numeric, is_elite boolean, product_name text,
  product_brand text, product_price text, product_image_url text, product_url text, product_gender text,
  product_type text, score double precision)
language plpgsql stable as $function$
declare
  v_types text[];
  v_tax   text[];
  v_color text;  -- regex alternation for the detected color family, or NULL
begin
  -- ---- Stage 1: deterministic facet extraction --------------------------------
  v_types := case
    when lower(query_text) ~* '\m(shirt|shirts|tee|tees|t-shirt|t-shirts|blouse|blouses|polo|polos|henley|henleys|button-up|button-down|top|tops)\M' then array['Top','Shirt','T-Shirt']
    when lower(query_text) ~* '\m(short|shorts)\M' then array['Shorts']
    when lower(query_text) ~* '\m(pant|pants|trouser|trousers|jean|jeans|denim|chino|chinos)\M' then array['Pants']
    when lower(query_text) ~* '\m(jacket|jackets|coat|coats|blazer|blazers|outerwear)\M' then array['Jacket']
    when lower(query_text) ~* '\m(shoe|shoes|sneaker|sneakers|trainer|trainers|boot|boots|sandal|sandals|loafer|loafers|heel|heels|slipper|slippers)\M' then array['Shoes','Sneakers']
    when lower(query_text) ~* '\m(hat|hats|cap|caps|beanie|beanies)\M' then array['Hat']
    when lower(query_text) ~* '\m(sweater|sweaters|jumper|jumpers|cardigan|cardigans|knit|knits|pullover|pullovers|hoodie|hoodies)\M' then array['Sweater','Top']
    when lower(query_text) ~* '\m(sunglasses|sunglass|sunnies|shades|eyewear)\M' then array['Sunglasses']
    when lower(query_text) ~* '\m(dress|dresses)\M' then array['Dress']
    when lower(query_text) ~* '\m(skirt|skirts)\M' then array['Skirt']
    else null::text[] end;

  v_tax := case
    when lower(query_text) ~* '\m(shirt|shirts|tee|tees|t-shirt|t-shirts|blouse|blouses|polo|polos|henley|henleys|button-up|button-down|top|tops)\M' then array['tops']
    when lower(query_text) ~* '\m(short|shorts|pant|pants|trouser|trousers|jean|jeans|denim|chino|chinos)\M' then array['bottoms']
    when lower(query_text) ~* '\m(jacket|jackets|coat|coats|blazer|blazers|outerwear)\M' then array['outerwear']
    when lower(query_text) ~* '\m(shoe|shoes|sneaker|sneakers|trainer|trainers|boot|boots|sandal|sandals|loafer|loafers|heel|heels|slipper|slippers)\M' then array['footwear']
    when lower(query_text) ~* '\m(sweater|sweaters|jumper|jumpers|cardigan|cardigans|knit|knits|pullover|pullovers|hoodie|hoodies)\M' then array['knitwear']
    when lower(query_text) ~* '\m(sunglasses|sunglass|sunnies|shades|eyewear)\M' then array['eyewear']
    when lower(query_text) ~* '\m(dress|dresses)\M' then array['dresses']
    when lower(query_text) ~* '\m(skirt|skirts)\M' then array['bottoms']
    else null::text[] end;

  v_color := case
    when lower(query_text) ~* '\m(white|off.?white|cream|ivory|sail|ecru|bone|chalk)\M' then '(white|off.?white|cream|ivory|sail|ecru|bone|chalk)'
    when lower(query_text) ~* '\m(black|onyx|jet)\M' then '(black|onyx|jet)'
    when lower(query_text) ~* '\m(blue|navy|cobalt|indigo|tidal)\M' then '(blue|navy|cobalt|indigo|tidal)'
    when lower(query_text) ~* '\m(grey|gray|charcoal|slate)\M' then '(grey|gray|charcoal|slate)'
    when lower(query_text) ~* '\m(brown|tan|chocolate|mocha|coffee|cappuccino|chestnut|camel)\M' then '(brown|tan|chocolate|mocha|coffee|cappuccino|chestnut|camel)'
    when lower(query_text) ~* '\m(beige|sand|naturale|nude|taupe|cashew)\M' then '(beige|sand|naturale|nude|taupe|cashew)'
    when lower(query_text) ~* '\m(green|olive|sage|olivine)\M' then '(green|olive|sage|olivine)'
    when lower(query_text) ~* '\m(red|burgundy|maroon)\M' then '(red|burgundy|maroon)'
    when lower(query_text) ~* '\m(pink|blush|rose)\M' then '(pink|blush|rose)'
    else null::text end;

  -- ---- Route ------------------------------------------------------------------
  if v_types is not null or v_tax is not null then
    -- ===== STRUCTURED PATH (category query) =====
    return query
    with cat_base as (
      select p.* from public.products p
      where p.is_active = true
        and (filter_gender is null or p.gender = filter_gender or p.gender = 'unisex')
        and not (p.id = any(exclude_ids))
        and (p.type = any(v_types) or lower(p.product_taxonomy->>'category') = any(v_tax))
    ),
    scored as (
      select b.*,
        case when v_color is not null
               and lower(coalesce(b.product_taxonomy->>'color','')) ~ v_color
             then 1.0 else 0.0 end as color_tier,
        ts_rank_cd(
          setweight(to_tsvector('english', coalesce(b.name,'')), 'A') ||
          setweight(to_tsvector('english', coalesce(public.product_occasions_text(b.styling_metadata, b.fit_intelligence, b.product_taxonomy),'')), 'B'),
          coalesce(nullif(replace(plainto_tsquery('english', query_text)::text, ' & ', ' | '), '')::tsquery, plainto_tsquery('english',''))
        ) as text_score,
        coalesce(b.conversion_score, 0)::double precision as pop
      from cat_base b
    ),
    deduped as (
      select s.*,
        lower(trim(coalesce(s.brand,'') || ' ' ||
          regexp_replace(coalesce(s.name,''), '\s*[-–—]\s*[^-–—]+$', ''))) as family_key,
        row_number() over (
          partition by lower(trim(coalesce(s.brand,'') || ' ' ||
            regexp_replace(coalesce(s.name,''), '\s*[-–—]\s*[^-–—]+$', '')))
          order by (case when v_color is not null and lower(coalesce(s.product_taxonomy->>'color','')) ~ v_color then 1.0 else 0.0 end) desc,
                   s.text_score desc, coalesce(s.conversion_score,0) desc, s.id
        ) as fam_rk
      from scored s
    )
    select d.id, d.id, null::uuid, (d.primary_video_url is null), d.primary_video_url,
      coalesce(d.primary_image_url, d.image_url), d.url,
      case when d.primary_video_duration_ms is not null then d.primary_video_duration_ms::numeric/1000.0 else null end,
      coalesce(d.is_elite,false), d.name, d.brand, coalesce(d.discounted_price, d.price),
      d.image_url, d.url, d.gender, d.type,
      (d.color_tier + least(d.text_score, 1.0) * 0.3 + least(d.pop,100)/100000.0)::double precision as score
    from deduped d
    where d.fam_rk = 1
    order by d.color_tier desc, d.text_score desc, d.pop desc
    limit k;

  else
    -- ===== HYBRID PATH (vibe / open query) — V6.1 logic, verbatim =====
    return query
    with
    base as (
      select p.* from public.products p
      where p.is_active = true
        and (filter_gender is null or p.gender = filter_gender or p.gender = 'unisex')
        and not (p.id = any(exclude_ids))
    ),
    matched_catalogs as (
      select c.id, lower(c.name) as lname from public.catalogs c
      where position(lower(c.name) in lower(query_text)) > 0
    ),
    curated as (
      select distinct b.id from base b
      where exists (select 1 from matched_catalogs mc join public.catalog_products cp on cp.catalog_id = mc.id where cp.product_id = b.id)
         or exists (select 1 from matched_catalogs mc cross join jsonb_array_elements_text(coalesce(b.catalog_tags,'[]'::jsonb)) as t(val) where lower(t.val) = mc.lname)
    ),
    dense as (
      select b.id, row_number() over (order by b.embedding <=> query_embedding) as rk
      from base b where b.embedding is not null limit k * 4
    ),
    bm25_q as (
      select
        nullif(plainto_tsquery('english', query_text)::text, '')::tsquery as q_and,
        nullif(replace(plainto_tsquery('english', query_text)::text, ' & ', ' | '), '')::tsquery as q_or
    ),
    doc as (
      select b.id,
        setweight(to_tsvector('english', coalesce(b.name,'')), 'A') ||
        setweight(to_tsvector('english', coalesce(public.product_occasions_text(b.styling_metadata, b.fit_intelligence, b.product_taxonomy),'')), 'A') ||
        setweight(to_tsvector('english', coalesce(b.brand,'')), 'B') ||
        setweight(to_tsvector('english', coalesce(b.type,'')), 'B') as tsv
      from base b
    ),
    bm25 as (
      select d.id,
        (q.q_and is not null and d.tsv @@ q.q_and) as full_match,
        ts_rank_cd(d.tsv, q.q_or) as text_score,
        row_number() over (order by (q.q_and is not null and d.tsv @@ q.q_and) desc, ts_rank_cd(d.tsv, q.q_or) desc) as rk
      from doc d, bm25_q q
      where q.q_or is not null and d.tsv @@ q.q_or
      limit k * 4
    ),
    rrf as (
      select coalesce(d.id, b.id) as id,
        coalesce(1.0/(60.0+d.rk),0.0) + coalesce(1.0/(60.0+b.rk),0.0)
          + case when b.full_match then 0.006 else 0.0 end as rrf_score
      from dense d full outer join bm25 b on b.id = d.id
      where b.id is not null
    ),
    scored as (
      select rrf.id, rrf.rrf_score as score
      from rrf
      where rrf.rrf_score >= case when (select max(text_score) from bm25) >= 0.1 then 0.020 else 0.015 end
    ),
    candidates as (
      select coalesce(s.id, cur.id) as id,
        coalesce(s.score,0.0) + case when cur.id is not null then 0.05 else 0.0 end as score
      from (select scored.id, scored.score from scored order by scored.score desc limit k * 3) s
      full outer join curated cur on cur.id = s.id
    ),
    joined as (
      select p.*, c.score,
        lower(trim(coalesce(p.brand,'') || ' ' ||
          regexp_replace(coalesce(p.name,''), '\s*[-–—]\s*[^-–—]+$', ''))) as family_key
      from candidates c join public.products p on p.id = c.id
    ),
    deduped as (
      select j.*, row_number() over (partition by j.family_key order by j.score desc, j.id) as fam_rk from joined j
    )
    select d.id, d.id, null::uuid, (d.primary_video_url is null), d.primary_video_url,
      coalesce(d.primary_image_url, d.image_url), d.url,
      case when d.primary_video_duration_ms is not null then d.primary_video_duration_ms::numeric/1000.0 else null end,
      coalesce(d.is_elite,false), d.name, d.brand, coalesce(d.discounted_price, d.price),
      d.image_url, d.url, d.gender, d.type, d.score::double precision
    from deduped d
    where d.fam_rk = 1
    order by d.score desc
    limit k;
  end if;
end;
$function$;
