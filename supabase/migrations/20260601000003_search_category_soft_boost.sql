-- search_products — convert the category-intent type GATE into a soft BOOST.
--
-- Problem: category_intent mapped a query word to ONE canonical label and then
-- hard-filtered `p.type = any(allowed_types)`. Products whose `type` is a
-- synonym the map didn't list were silently dropped, even when BM25 + dense both
-- ranked them #1:
--   • "sneakers" → ['Shoes']  excluded type='Sneakers'  → New Balance 574 (has a
--     creative) returned 0 results.
--   • "shirt"/"tee" → ['Top']  excluded type='Shirt' and 'T-Shirt'.
-- It also doesn't scale: every new product category (furniture, kitchenware…)
-- needs a new regex branch or it gets filtered out.
--
-- Fix:
--   1. Expand each intent bucket to include the real `type` synonyms.
--   2. Apply the match as a +0.03 score BOOST (before the relevance threshold so
--      boosted items clear it), NOT a filter. Matching-category items float to
--      the top; everything else still surfaces, just lower. Off-taxonomy / future
--      types are never excluded — the worst case is a slightly lower rank.
-- Ranking hierarchy: curated (+0.05) > category match (+0.03) > organic RRF.

create or replace function public.search_products(
  query_embedding vector,
  query_text text,
  k integer default 24,
  filter_gender text default null::text,
  exclude_ids uuid[] default '{}'::uuid[]
)
returns table(
  id uuid, product_id uuid, creative_id uuid, is_placeholder boolean,
  video_url text, thumbnail_url text, affiliate_url text, duration_seconds numeric,
  is_elite boolean, product_name text, product_brand text, product_price text,
  product_image_url text, product_url text, product_gender text, product_type text,
  score double precision
)
language sql
stable
as $function$
  with
  base as (
    select p.*
    from public.products p
    where p.is_active = true
      and (filter_gender is null
           or p.gender is null
           or p.gender = filter_gender
           or p.gender = 'unisex')
      and not (p.id = any(exclude_ids))
  ),
  matched_catalogs as (
    select c.id, lower(c.name) as lname
    from public.catalogs c
    where position(lower(c.name) in lower(query_text)) > 0
  ),
  curated as (
    select distinct b.id
    from base b
    where exists (
            select 1
            from matched_catalogs mc
            join public.catalog_products cp on cp.catalog_id = mc.id
            where cp.product_id = b.id
          )
       or exists (
            select 1
            from matched_catalogs mc
            cross join jsonb_array_elements_text(coalesce(b.catalog_tags, '[]'::jsonb)) as t(val)
            where lower(t.val) = mc.lname
          )
  ),
  dense as (
    select
      b.id,
      row_number() over (order by b.embedding <=> query_embedding) as rk
    from base b
    where b.embedding is not null
    limit k * 4
  ),
  bm25_q as (
    select plainto_tsquery('english', query_text) as q
  ),
  bm25 as (
    select
      b.id,
      row_number() over (
        order by ts_rank_cd(
          setweight(to_tsvector('english', coalesce(b.name, '')),        'A') ||
          setweight(to_tsvector('english', coalesce(b.brand, '')),       'B') ||
          setweight(to_tsvector('english', coalesce(b.type, '')),        'B') ||
          setweight(to_tsvector('english', coalesce(b.description, '')), 'C'),
          bm25_q.q
        ) desc
      ) as rk,
      ts_rank_cd(
        setweight(to_tsvector('english', coalesce(b.name, '')),        'A') ||
        setweight(to_tsvector('english', coalesce(b.brand, '')),       'B') ||
        setweight(to_tsvector('english', coalesce(b.type, '')),        'B') ||
        setweight(to_tsvector('english', coalesce(b.description, '')), 'C'),
        bm25_q.q
      ) as text_score
    from base b, bm25_q
    where (
        setweight(to_tsvector('english', coalesce(b.name, '')),        'A') ||
        setweight(to_tsvector('english', coalesce(b.brand, '')),       'B') ||
        setweight(to_tsvector('english', coalesce(b.type, '')),        'B') ||
        setweight(to_tsvector('english', coalesce(b.description, '')), 'C')
      ) @@ bm25_q.q
    limit k * 4
  ),
  -- Intent → expanded set of *actual* type labels. Because this now BOOSTS
  -- rather than filters, a generous/overlapping set is safe: it can only lift
  -- the right items, never exclude.
  category_intent as (
    select case
      when lower(query_text) ~* '\m(shirt|shirts|tee|tees|t-shirt|t-shirts|blouse|blouses|polo|polos|henley|henleys|button-up|button-down|top|tops)\M'
        then array['Top','Shirt','T-Shirt']::text[]
      when lower(query_text) ~* '\m(short|shorts)\M'
        then array['Shorts']::text[]
      when lower(query_text) ~* '\m(pant|pants|trouser|trousers|jean|jeans|denim|chino|chinos)\M'
        then array['Pants']::text[]
      when lower(query_text) ~* '\m(jacket|jackets|coat|coats|blazer|blazers|outerwear)\M'
        then array['Jacket']::text[]
      when lower(query_text) ~* '\m(shoe|shoes|sneaker|sneakers|trainer|trainers|boot|boots|sandal|sandals|loafer|loafers|heel|heels)\M'
        then array['Shoes','Sneakers']::text[]
      when lower(query_text) ~* '\m(hat|hats|cap|caps|beanie|beanies)\M'
        then array['Hat']::text[]
      when lower(query_text) ~* '\m(sweater|sweaters|jumper|jumpers|cardigan|cardigans|knit|knits|pullover|pullovers|hoodie|hoodies)\M'
        then array['Sweater','Top']::text[]
      when lower(query_text) ~* '\m(sunglasses|sunglass|sunnies|shades|eyewear)\M'
        then array['Sunglasses']::text[]
      when lower(query_text) ~* '\m(dress|dresses)\M'
        then array['Dress']::text[]
      when lower(query_text) ~* '\m(skirt|skirts)\M'
        then array['Skirt']::text[]
      else null::text[]
    end as allowed_types
  ),
  fashion_context as (
    select lower(query_text) ~* (
      '\m('
      || 'party|cocktail|formal|evening|gala|prom|wedding|bridal'
      || '|night\s+out|going\s+out|club|date|romantic|brunch|dinner'
      || '|beach|pool|resort|vacation|tropical|outdoor|travel'
      || '|office|work|professional|business|corporate'
      || '|workout|gym|athletic|yoga|running|training|sport|fitness'
      || '|lounge|cozy|relaxed|laid-back'
      || '|summer|spring|winter|fall|autumn|cold|warm'
      || '|streetwear|street\s+style|urban|bohemian|boho|vintage|retro'
      || '|classic|timeless|minimalist|modern|trendy|chic|elegant|edgy|preppy'
      || '|luxury|designer|premium|high-end|couture'
      || '|fashion|style|outfit|wear|look|attire|apparel|clothing|wardrobe|ensemble'
      || '|activewear|athleisure|sportswear|formalwear|swimwear|loungewear|workwear'
      || ')\M'
    ) as detected
  ),
  rrf as (
    select
      coalesce(d.id, b.id) as id,
      coalesce(1.0 / (60.0 + d.rk), 0.0) +
      coalesce(1.0 / (60.0 + b.rk), 0.0) as rrf_score
    from dense d
    full outer join bm25 b on b.id = d.id
    where b.id is not null
       or (select allowed_types from category_intent) is not null
       or (select detected from fashion_context)
  ),
  -- Soft category boost: applied BEFORE the threshold so a matching-type product
  -- that would otherwise fall under the relevance floor still surfaces.
  scored as (
    select
      rrf.id,
      rrf.rrf_score
      + case
          when ci.allowed_types is not null and bse.type = any(ci.allowed_types)
          then 0.03 else 0.0
        end as score
    from rrf
    join base bse on bse.id = rrf.id
    cross join category_intent ci
  ),
  ranked as (
    select
      coalesce(s.id, cur.id)                                          as id,
      coalesce(s.score, 0.0) + case when cur.id is not null then 0.05 else 0.0 end as score
    from (
      select id, score
      from scored
      where score >= case
        when (select max(text_score) from bm25) >= 0.1 then 0.020
        else 0.015
      end
      order by score desc
      limit k
    ) s
    full outer join curated cur on cur.id = s.id
    order by score desc
    limit k
  ),
  graph_boost as (
    select
      r.id,
      r.score + (
        coalesce((
          select count(*)::float * 0.002
          from public.entity_edges e
          where e.src_id = r.id
            and e.src_type = 'product'
            and e.edge_type = 'pairs_with'
            and e.dst_id in (select id from ranked)
        ), 0.0)
      ) as score
    from ranked r
  )
  select
    coalesce(c.id, p.id)                  as id,
    p.id                                   as product_id,
    c.id                                   as creative_id,
    c.id is null                           as is_placeholder,
    c.video_url,
    c.thumbnail_url,
    c.affiliate_url,
    c.duration_seconds,
    coalesce(c.is_elite, false)            as is_elite,
    p.name                                 as product_name,
    p.brand                                as product_brand,
    coalesce(p.discounted_price, p.price)  as product_price,
    p.image_url                            as product_image_url,
    p.url                                  as product_url,
    p.gender                               as product_gender,
    p.type                                 as product_type,
    gb.score
  from graph_boost gb
  join public.products p on p.id = gb.id
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
  order by gb.score desc;
$function$;
