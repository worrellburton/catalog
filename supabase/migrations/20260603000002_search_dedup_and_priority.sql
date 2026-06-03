-- Search V6.1 — precision + de-duplication follow-ups on top of the
-- occasion-aware rewrite (20260603000001).
--
-- Three changes:
--   1. AND-priority ranking. The BM25 lane still ADMITS on OR-semantics (recall
--      for multi-word vibe phrases), but full AND matches sort first and get a
--      small boost — so "date night" leads with items tagged the whole phrase,
--      and single-term partials ("coffee dates" → matches only "date") sink.
--   2. Drop `description` from the searchable doc. It carries legacy v1
--      enrichment prose + raw marketing copy where stray query words ("night",
--      "date") matched by accident — that's exactly how laundry detergent and a
--      romance novel leaked into "date night". Relevance now rests on name +
--      honest structured occasions (styling_metadata.occasion) + brand + type.
--   3. Family de-dup. Collapse colorway / variant duplicates (e.g. the same
--      sandal in five colors) to the best-scoring item per family, so a single
--      product line can't flood the grid.
create or replace function public.search_products(
  query_embedding vector(384), query_text text, k integer default 24,
  filter_gender text default null, exclude_ids uuid[] default '{}'::uuid[]
)
returns table(id uuid, product_id uuid, creative_id uuid, is_placeholder boolean, video_url text,
  thumbnail_url text, affiliate_url text, duration_seconds numeric, is_elite boolean, product_name text,
  product_brand text, product_price text, product_image_url text, product_url text, product_gender text,
  product_type text, score double precision)
language sql stable as $function$
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
  category_intent as (
    select case
      when lower(query_text) ~* '\m(shirt|shirts|tee|tees|t-shirt|t-shirts|blouse|blouses|polo|polos|henley|henleys|button-up|button-down|top|tops)\M' then array['Top','Shirt','T-Shirt']::text[]
      when lower(query_text) ~* '\m(short|shorts)\M' then array['Shorts']::text[]
      when lower(query_text) ~* '\m(pant|pants|trouser|trousers|jean|jeans|denim|chino|chinos)\M' then array['Pants']::text[]
      when lower(query_text) ~* '\m(jacket|jackets|coat|coats|blazer|blazers|outerwear)\M' then array['Jacket']::text[]
      when lower(query_text) ~* '\m(shoe|shoes|sneaker|sneakers|trainer|trainers|boot|boots|sandal|sandals|loafer|loafers|heel|heels)\M' then array['Shoes','Sneakers']::text[]
      when lower(query_text) ~* '\m(hat|hats|cap|caps|beanie|beanies)\M' then array['Hat']::text[]
      when lower(query_text) ~* '\m(sweater|sweaters|jumper|jumpers|cardigan|cardigans|knit|knits|pullover|pullovers|hoodie|hoodies)\M' then array['Sweater','Top']::text[]
      when lower(query_text) ~* '\m(sunglasses|sunglass|sunnies|shades|eyewear)\M' then array['Sunglasses']::text[]
      when lower(query_text) ~* '\m(dress|dresses)\M' then array['Dress']::text[]
      when lower(query_text) ~* '\m(skirt|skirts)\M' then array['Skirt']::text[]
      else null::text[] end as allowed_types
  ),
  rrf as (
    select coalesce(d.id, b.id) as id,
      coalesce(1.0/(60.0+d.rk),0.0) + coalesce(1.0/(60.0+b.rk),0.0)
        + case when b.full_match then 0.006 else 0.0 end as rrf_score
    from dense d full outer join bm25 b on b.id = d.id
    where b.id is not null or (select allowed_types from category_intent) is not null
  ),
  scored as (
    select rrf.id,
      rrf.rrf_score + case when ci.allowed_types is not null and bse.type = any(ci.allowed_types) then 0.03 else 0.0 end as score
    from rrf join base bse on bse.id = rrf.id cross join category_intent ci
    where rrf.rrf_score >= case when (select max(text_score) from bm25) >= 0.1 then 0.020 else 0.015 end
  ),
  candidates as (
    select coalesce(s.id, cur.id) as id,
      coalesce(s.score,0.0) + case when cur.id is not null then 0.05 else 0.0 end as score
    from (select id, score from scored order by score desc limit k * 3) s
    full outer join curated cur on cur.id = s.id
  ),
  joined as (
    select p.*, c.score,
      lower(trim(coalesce(p.brand,'') || ' ' ||
        regexp_replace(coalesce(p.name,''), '\s*[-–—]\s*[^-–—]+$', ''))) as family_key
    from candidates c join public.products p on p.id = c.id
  ),
  deduped as (
    select *, row_number() over (partition by family_key order by score desc, id) as fam_rk from joined
  )
  select d.id, d.id, null::uuid, (d.primary_video_url is null), d.primary_video_url,
    coalesce(d.primary_image_url, d.image_url), d.url,
    case when d.primary_video_duration_ms is not null then d.primary_video_duration_ms::numeric/1000.0 else null end,
    coalesce(d.is_elite,false), d.name, d.brand, coalesce(d.discounted_price, d.price),
    d.image_url, d.url, d.gender, d.type, d.score
  from deduped d
  where d.fam_rk = 1
  order by d.score desc
  limit k;
$function$;