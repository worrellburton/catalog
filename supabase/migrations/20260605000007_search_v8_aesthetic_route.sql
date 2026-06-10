-- Search V8 (SHADOW) — adds a third route: department-aware AESTHETIC routing.
--
-- Routes, in priority order:
--   1. CATEGORY  (product-type noun)  -> V7 structured path (unchanged)
--   2. AESTHETIC (fashion-trend term) -> NEW: filter to the apparel department,
--      rank by BM25 over an EXPANDED query (trend term + canonical apparel tokens).
--      Pure BM25 + department filter — no dense lane (gte-small is non-discriminative
--      here), so it's deterministic. Fixes "quiet luxury -> candles": candles are
--      home/beauty, filtered out; understated apparel rises.
--   3. VIBE/open -> V7 hybrid path (unchanged)
--
-- Aesthetic terms are distinctive (no bare "luxury"), so "luxury candle" does NOT
-- trigger this route — it falls through to the vibe path and still returns candles.
-- Additive shadow; production search_products untouched.

create or replace function public.search_products_v8(
  query_embedding vector(384), query_text text, k integer default 24,
  filter_gender text default null, exclude_ids uuid[] default '{}'::uuid[]
)
returns table(id uuid, product_id uuid, creative_id uuid, is_placeholder boolean, video_url text,
  thumbnail_url text, affiliate_url text, duration_seconds numeric, is_elite boolean, product_name text,
  product_brand text, product_price text, product_image_url text, product_url text, product_gender text,
  product_type text, score double precision)
language plpgsql stable as $function$
declare
  v_types  text[];
  v_tax    text[];
  v_color  text;
  v_subcat text;
  v_aesthetic text;
  v_expand    text;
  v_aes_q     tsquery;
  v_q_or      tsquery;
  apparel_cats text[] := array['footwear','tops','bottoms','dresses','outerwear','knitwear','activewear','fashion','eyewear'];
begin
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

  v_subcat := case
    when lower(query_text) ~* '\m(jean|jeans|denim)\M' then '(jean|denim)'
    when lower(query_text) ~* '\m(trouser|trousers|chino|chinos|slacks)\M' then '(trouser|chino|slack)'
    when lower(query_text) ~* '\m(short|shorts)\M' then '(short)'
    when lower(query_text) ~* '\m(t-shirt|t-shirts|tee|tees)\M' then '(tee|t-shirt|short sleeve)'
    when lower(query_text) ~* '\m(polo|polos)\M' then '(polo)'
    when lower(query_text) ~* '\m(tank|tanks)\M' then '(tank)'
    when lower(query_text) ~* '\m(hoodie|hoodies)\M' then '(hoodie)'
    when lower(query_text) ~* '\m(cardigan|cardigans)\M' then '(cardigan)'
    when lower(query_text) ~* '\m(boot|boots)\M' then '(boot)'
    when lower(query_text) ~* '\m(sandal|sandals)\M' then '(sandal|slide|thong)'
    when lower(query_text) ~* '\m(sneaker|sneakers|trainer|trainers)\M' then '(sneaker|trainer|low.?top)'
    when lower(query_text) ~* '\m(loafer|loafers)\M' then '(loafer)'
    when lower(query_text) ~* '\m(heel|heels)\M' then '(heel|pump)'
    when lower(query_text) ~* '\m(slipper|slippers)\M' then '(slipper)'
    when lower(query_text) ~* '\m(maxi)\M' then '(maxi)'
    when lower(query_text) ~* '\m(midi)\M' then '(midi)'
    when lower(query_text) ~* '\m(mini)\M' then '(mini)'
    else null::text end;

  -- Aesthetic / trend detection (distinctive terms only — no bare "luxury").
  v_aesthetic := case
    when lower(query_text) ~* '\mquiet luxury\M'    then 'quiet_luxury'
    when lower(query_text) ~* '\mold money\M'       then 'old_money'
    when lower(query_text) ~* '\mclean girl\M'      then 'clean_girl'
    when lower(query_text) ~* '\mcoastal grandma\M' then 'coastal_grandma'
    when lower(query_text) ~* '\mmob wife\M'        then 'mob_wife'
    when lower(query_text) ~* '\m(streetwear|street style)\M' then 'streetwear'
    when lower(query_text) ~* '\my2k\M'             then 'y2k'
    when lower(query_text) ~* '\mcoquette\M'        then 'coquette'
    when lower(query_text) ~* '\mgorpcore\M'        then 'gorpcore'
    when lower(query_text) ~* '\mpreppy\M'          then 'preppy'
    when lower(query_text) ~* '\m(boho|bohemian)\M' then 'bohemian'
    when lower(query_text) ~* '\mathleisure\M'      then 'athleisure'
    else null end;

  v_expand := case v_aesthetic
    when 'quiet_luxury'    then 'minimal | tailored | refined | cashmere | classic | luxuri'
    when 'old_money'       then 'classic | tailored | heritage | preppy | refined | polo'
    when 'clean_girl'      then 'minimal | effortless | natural | sleek'
    when 'coastal_grandma' then 'linen | relaxed | coastal | resort | neutral'
    when 'mob_wife'        then 'bold | fur | leather | glamorous | statement'
    when 'streetwear'      then 'streetwear | street | oversized | graphic | sneaker'
    when 'y2k'             then 'retro | denim | baby | crop'
    when 'coquette'        then 'feminine | bow | lace | romantic'
    when 'gorpcore'        then 'technical | outdoor | utility | performance'
    when 'preppy'          then 'preppy | classic | collegiate | polo'
    when 'bohemian'        then 'bohemian | boho | flowy | crochet | linen'
    when 'athleisure'      then 'athleisure | athletic | active | legging'
    else '' end;

  -- ===== 1. CATEGORY (V7 structured path) =====
  if v_types is not null or v_tax is not null then
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
        case when v_subcat is not null
               and (lower(coalesce(b.product_taxonomy->>'subcategory','')) ~ v_subcat
                    or lower(coalesce(b.name,'')) ~ v_subcat)
             then 1.0 else 0.0 end as subcat_tier,
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
        row_number() over (
          partition by lower(trim(coalesce(s.brand,'') || ' ' ||
            regexp_replace(coalesce(s.name,''), '\s*[-–—]\s*[^-–—]+$', '')))
          order by s.subcat_tier desc, s.color_tier desc, s.text_score desc, coalesce(s.conversion_score,0) desc, s.id
        ) as fam_rk
      from scored s
    )
    select d.id, d.id, null::uuid, (d.primary_video_url is null), d.primary_video_url,
      coalesce(d.primary_image_url, d.image_url), d.url,
      case when d.primary_video_duration_ms is not null then d.primary_video_duration_ms::numeric/1000.0 else null end,
      coalesce(d.is_elite,false), d.name, d.brand, coalesce(d.discounted_price, d.price),
      d.image_url, d.url, d.gender, d.type,
      (d.subcat_tier * 2.0 + d.color_tier + least(d.text_score, 1.0) * 0.3 + least(d.pop,100)/100000.0)::double precision as score
    from deduped d
    where d.fam_rk = 1
    order by d.subcat_tier desc, d.color_tier desc, d.text_score desc, d.pop desc
    limit k;

  -- ===== 2. AESTHETIC (department-filtered, expanded BM25) =====
  elsif v_aesthetic is not null then
    v_q_or := nullif(replace(plainto_tsquery('english', query_text)::text, ' & ', ' | '), '')::tsquery;
    v_aes_q := case when v_q_or is null then to_tsquery('english', v_expand)
                    else v_q_or || to_tsquery('english', v_expand) end;
    return query
    with apparel_base as (
      select p.* from public.products p
      where p.is_active = true
        and (filter_gender is null or p.gender = filter_gender or p.gender = 'unisex')
        and not (p.id = any(exclude_ids))
        and lower(coalesce(p.product_taxonomy->>'category','')) = any(apparel_cats)
    ),
    doc as (
      select b.*,
        setweight(to_tsvector('english', coalesce(b.name,'')), 'A') ||
        setweight(to_tsvector('english', coalesce(public.product_occasions_text(b.styling_metadata, b.fit_intelligence, b.product_taxonomy),'')), 'A') ||
        setweight(to_tsvector('english', coalesce(b.type,'')), 'B') as tsv
      from apparel_base b
    ),
    matched as (
      select d.*, ts_rank_cd(d.tsv, v_aes_q) as text_score
      from doc d where d.tsv @@ v_aes_q
    ),
    deduped as (
      select m.*,
        row_number() over (
          partition by lower(trim(coalesce(m.brand,'') || ' ' ||
            regexp_replace(coalesce(m.name,''), '\s*[-–—]\s*[^-–—]+$', '')))
          order by m.text_score desc, coalesce(m.conversion_score,0) desc, m.id
        ) as fam_rk
      from matched m
    )
    select d.id, d.id, null::uuid, (d.primary_video_url is null), d.primary_video_url,
      coalesce(d.primary_image_url, d.image_url), d.url,
      case when d.primary_video_duration_ms is not null then d.primary_video_duration_ms::numeric/1000.0 else null end,
      coalesce(d.is_elite,false), d.name, d.brand, coalesce(d.discounted_price, d.price),
      d.image_url, d.url, d.gender, d.type,
      (d.text_score + least(coalesce(d.conversion_score,0),100)/100000.0)::double precision as score
    from deduped d
    where d.fam_rk = 1
    order by d.text_score desc, coalesce(d.conversion_score,0) desc
    limit k;

  -- ===== 3. VIBE / open (V7 hybrid path) =====
  else
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
