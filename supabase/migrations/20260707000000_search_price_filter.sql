-- Search: structured price/budget predicate for Build-a-Catalog filters.
--
-- The Build-a-Catalog "Budget" chips (under $25 … $500+) were captured in the
-- UI but DROPPED before search — composeFilterQuery never forwarded them and
-- search_products had no price param, so picking a budget did nothing. This
-- adds filter_price text[] (bucket codes) as a HARD predicate on ALL THREE
-- search routes (category / aesthetic / vibe), mirroring the filter_gender
-- precedent, so the k-limit fills with in-budget products instead of being
-- thinned after the fact.
--
-- price is display text ("$98.00", "$135", occasionally a "$x - $y" range);
-- price_in_buckets extracts the first number and tests bucket membership.
-- Products with no parseable price are EXCLUDED when a budget is selected
-- (can't place an unpriced item in a band), included when no budget is set.
-- Filters on coalesce(discounted_price, price) — the SAME effective price the
-- row displays. Rollback: re-apply 20260608000001 (5-arg signature).

create or replace function public.price_in_buckets(price_text text, buckets text[])
returns boolean language sql immutable as $$
  select case
    when buckets is null or cardinality(buckets) = 0 then true
    else coalesce((
      select bool_or(
        (b = 'under25' and n <  25) or
        (b = '25-50'   and n >= 25  and n < 50) or
        (b = '50-100'  and n >= 50  and n < 100) or
        (b = '100-200' and n >= 100 and n < 200) or
        (b = '200-500' and n >= 200 and n < 500) or
        (b = '500plus' and n >= 500)
      )
      from unnest(buckets) as b,
        (select nullif(replace((regexp_match(coalesce(price_text, ''), '([0-9][0-9,]*\.?[0-9]*)'))[1], ',', ''), '')::numeric as n) as parsed
    ), false)
  end
$$;
grant execute on function public.price_in_buckets(text, text[]) to anon, authenticated, service_role;

-- Adding a parameter changes the signature, so the old 5-arg version must be
-- dropped (create-or-replace can't change the arg list). style_slot_search's
-- positional 5-arg call still resolves to the new 6-arg fn via the default.
drop function if exists public.search_products(vector, text, integer, text, uuid[]);

create or replace function public.search_products(
  query_embedding vector(384), query_text text, k integer default 24,
  filter_gender text default null, exclude_ids uuid[] default '{}'::uuid[],
  filter_price text[] default null
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
  v_aes_label text;
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

  v_aesthetic := case
    when lower(query_text) ~* '\mquiet luxury\M'    then 'quiet luxury'
    when lower(query_text) ~* '\mold money\M'       then 'old money'
    when lower(query_text) ~* '\mclean girl\M'      then 'clean girl'
    when lower(query_text) ~* '\mcoastal grandma\M' then 'coastal grandma'
    when lower(query_text) ~* '\mmob wife\M'        then 'mob wife'
    when lower(query_text) ~* '\m(streetwear|street style)\M' then 'streetwear'
    when lower(query_text) ~* '\my2k\M'             then 'y2k'
    when lower(query_text) ~* '\mcoquette\M'        then 'coquette'
    when lower(query_text) ~* '\mgorpcore\M'        then 'gorpcore'
    when lower(query_text) ~* '\mpreppy\M'          then 'preppy'
    when lower(query_text) ~* '\m(boho|bohemian)\M' then 'bohemian'
    when lower(query_text) ~* '\mathleisure\M'      then 'athleisure'
    else null end;

  v_expand := case v_aesthetic
    when 'quiet luxury'    then 'minimal | tailored | refined | cashmere | classic | luxuri'
    when 'old money'       then 'classic | tailored | heritage | preppy | refined | polo'
    when 'clean girl'      then 'minimal | effortless | natural | sleek'
    when 'coastal grandma' then 'linen | relaxed | coastal | resort | neutral'
    when 'mob wife'        then 'bold | fur | leather | glamorous | statement'
    when 'streetwear'      then 'streetwear | street | oversized | graphic | sneaker'
    when 'y2k'             then 'retro | denim | baby | crop'
    when 'coquette'        then 'feminine | bow | lace | romantic'
    when 'gorpcore'        then 'technical | outdoor | utility | performance'
    when 'preppy'          then 'preppy | classic | collegiate | polo'
    when 'bohemian'        then 'bohemian | boho | flowy | crochet | linen'
    when 'athleisure'      then 'athleisure | athletic | active | legging'
    else '' end;

  if v_types is not null or v_tax is not null then
    return query
    with cat_base as (
      select p.* from public.products p
      where p.is_active = true
        and (filter_gender is null or p.gender = filter_gender or p.gender = 'unisex')
        and public.price_in_buckets(coalesce(p.discounted_price, p.price), filter_price)
        and not (p.id = any(exclude_ids))
        and (p.type = any(v_types) or lower(p.product_taxonomy->>'category') = any(v_tax))
        -- STRICT color filter: when the query names a color, only admit
        -- products tagged that color family. No color in query → no filter.
        and (v_color is null or lower(coalesce(p.product_taxonomy->>'color','')) ~ v_color)
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

  elsif v_aesthetic is not null then
    v_aes_label := v_aesthetic;
    v_q_or := nullif(replace(plainto_tsquery('english', query_text)::text, ' & ', ' | '), '')::tsquery;
    v_aes_q := case when v_q_or is null then to_tsquery('english', v_expand)
                    else v_q_or || to_tsquery('english', v_expand) end;
    return query
    with apparel_base as (
      select p.* from public.products p
      where p.is_active = true
        and (filter_gender is null or p.gender = filter_gender or p.gender = 'unisex')
        and public.price_in_buckets(coalesce(p.discounted_price, p.price), filter_price)
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
      select d.*,
        ts_rank_cd(d.tsv, v_aes_q) as text_score,
        case when coalesce(d.styling_metadata->'aesthetic','[]'::jsonb) ? v_aes_label then 1.0 else 0.0 end as aes_tier
      from doc d
      where d.tsv @@ v_aes_q
         or coalesce(d.styling_metadata->'aesthetic','[]'::jsonb) ? v_aes_label
    ),
    deduped as (
      select m.*,
        row_number() over (
          partition by lower(trim(coalesce(m.brand,'') || ' ' ||
            regexp_replace(coalesce(m.name,''), '\s*[-–—]\s*[^-–—]+$', '')))
          order by m.aes_tier desc, m.text_score desc, coalesce(m.conversion_score,0) desc, m.id
        ) as fam_rk
      from matched m
    )
    select d.id, d.id, null::uuid, (d.primary_video_url is null), d.primary_video_url,
      coalesce(d.primary_image_url, d.image_url), d.url,
      case when d.primary_video_duration_ms is not null then d.primary_video_duration_ms::numeric/1000.0 else null end,
      coalesce(d.is_elite,false), d.name, d.brand, coalesce(d.discounted_price, d.price),
      d.image_url, d.url, d.gender, d.type,
      (d.aes_tier * 2.0 + d.text_score + least(coalesce(d.conversion_score,0),100)/100000.0)::double precision as score
    from deduped d
    where d.fam_rk = 1
    order by d.aes_tier desc, d.text_score desc, coalesce(d.conversion_score,0) desc
    limit k;

  else
    return query
    with
    base as (
      select p.* from public.products p
      where p.is_active = true
        and (filter_gender is null or p.gender = filter_gender or p.gender = 'unisex')
        and public.price_in_buckets(coalesce(p.discounted_price, p.price), filter_price)
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

grant execute on function public.search_products(vector, text, integer, text, uuid[], text[]) to anon, authenticated, service_role;
