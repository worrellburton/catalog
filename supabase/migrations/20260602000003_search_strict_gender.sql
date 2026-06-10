-- search_strict_gender — make search obey the SAME hard gender rule as the
-- home feed.
--
-- Before: search_products / search_looks let untagged rows (gender IS NULL)
-- pass for a gendered shopper. The consumer home feed already hides untagged
-- rows from gendered shoppers (passesGenderFilter: "untagged → hidden", and
-- the looks filter keeps only gender|unisex). Search must match, otherwise a
-- man searching "candles" still saw untagged / off-domain inventory.
--
-- After (gendered shopper, filter_gender set): see ONLY <gender> + unisex.
-- Untagged and opposite-gender are hidden. filter_gender NULL (shopper = all /
-- unknown) is unchanged: everything passes. Unisex stays visible for everyone.
--
-- The only change vs the prior definitions is dropping the `gender is null`
-- branch from each base CTE's gender predicate. Everything else (RRF, BM25,
-- category intent, primary-video-only contract) is reproduced verbatim.

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
    p.id                                                    as id,
    p.id                                                    as product_id,
    null::uuid                                              as creative_id,
    (p.primary_video_url is null)                           as is_placeholder,
    p.primary_video_url                                     as video_url,
    coalesce(p.primary_image_url, p.image_url)              as thumbnail_url,
    p.url                                                   as affiliate_url,
    case when p.primary_video_duration_ms is not null
         then p.primary_video_duration_ms::numeric / 1000.0
         else null end                                      as duration_seconds,
    coalesce(p.is_elite, false)                             as is_elite,
    p.name                                                  as product_name,
    p.brand                                                 as product_brand,
    coalesce(p.discounted_price, p.price)                   as product_price,
    p.image_url                                             as product_image_url,
    p.url                                                   as product_url,
    p.gender                                                as product_gender,
    p.type                                                  as product_type,
    gb.score
  from graph_boost gb
  join public.products p on p.id = gb.id
  order by gb.score desc;
$function$;

drop function if exists public.search_looks(vector, text, int, text);

create or replace function public.search_looks(
  query_embedding vector(384),
  query_text      text,
  k               int  default 12,
  filter_gender   text default null
)
returns table (
  id              uuid,
  legacy_id       bigint,
  title           text,
  creator_handle  text,
  description     text,
  gender          text,
  video_url       text,
  thumbnail_url   text,
  mobile_video_url text,
  score           double precision
)
language sql stable
as $$
  with
  base as (
    select l.*
    from public.looks l
    where (l.status = 'live' or l.status is null)
      and (filter_gender is null
           or l.gender = filter_gender
           or l.gender = 'unisex')
  ),
  dense as (
    select
      b.id,
      row_number() over (order by b.embedding <=> query_embedding) as rk
    from base b
    where b.embedding is not null
    limit k * 4
  ),
  look_product_text as (
    select
      lp.look_id,
      string_agg(coalesce(p.name, '') || ' ' || coalesce(p.brand, ''), ' ') as product_text
    from public.look_products lp
    join public.products p on p.id = lp.product_id
    group by lp.look_id
  ),
  bm25_q as (
    select plainto_tsquery('english', query_text) as q
  ),
  bm25 as (
    select
      b.id,
      row_number() over (
        order by ts_rank_cd(
          setweight(to_tsvector('english', coalesce(b.title, '')),          'A') ||
          setweight(to_tsvector('english', coalesce(b.creator_handle, '')), 'B') ||
          setweight(to_tsvector('english', coalesce(b.description, '')),    'C') ||
          setweight(to_tsvector('english', coalesce(lpt.product_text, '')), 'C'),
          bm25_q.q
        ) desc
      ) as rk
    from base b
    cross join bm25_q
    left join look_product_text lpt on lpt.look_id = b.id
    where (
        setweight(to_tsvector('english', coalesce(b.title, '')),          'A') ||
        setweight(to_tsvector('english', coalesce(b.creator_handle, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(b.description, '')),    'C') ||
        setweight(to_tsvector('english', coalesce(lpt.product_text, '')), 'C')
      ) @@ bm25_q.q
    limit k * 4
  ),
  -- Require BM25 match; dense is a ranking boost only. With ~21 looks,
  -- dense-only matches are just nearest-neighbor-of-everything noise.
  rrf as (
    select
      b.id,
      coalesce(1.0 / (30.0 + d.rk), 0.0) +
      coalesce(1.0 / (30.0 + b.rk), 0.0) as score
    from bm25 b
    left join dense d on d.id = b.id
  ),
  ranked as (
    select id, score
    from rrf
    order by score desc
    limit k
  )
  select
    l.id,
    l.legacy_id,
    l.title,
    l.creator_handle,
    l.description,
    l.gender,
    c.video_url,
    c.thumbnail_url,
    c.mobile_video_url,
    r.score
  from ranked r
  join public.looks l on l.id = r.id
  left join lateral (
    select lc.video_url, lc.thumbnail_url, lc.mobile_video_url
    from public.looks_creative lc
    where lc.look_id = l.id
      and lc.is_primary = true
      and lc.video_url is not null
    limit 1
  ) c on true
  where c.video_url is not null
  order by r.score desc;
$$;

comment on function public.search_looks(vector, text, int, text) is
  'Hybrid look search: requires BM25 text match (title + creator + description + product names), dense as ranking boost. k=30 RRF tuned for small corpus. Strict gender: gendered shopper sees gender|unisex only (untagged hidden).';

grant execute on function public.search_looks(vector, text, int, text)
  to anon, authenticated, service_role;
