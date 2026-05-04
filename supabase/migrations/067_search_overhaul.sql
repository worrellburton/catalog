-- 067 — Search Overhaul (Tier 0 + Tier 1)
--
-- Implements the changes called out in the search RCA:
--   T0.1  product_types_canonical view (source of truth for type taxonomy)
--   T0.2  products.category column (fashion|beauty|home|tech|lifestyle|other)
--         + heuristic backfill + auto-classify trigger
--   T0.4  search_creatives_hybrid: soft type filter (relax when pool < min_results)
--   T0.5  diversify by product_id at SQL layer (max N creatives per product)
--   T0.6  lower concept_doc BM25 weight A → B
--   T0.7  query_embeddings: expires_at + embedding_v + expansion_v columns
--   T0.8  products mutation → mark joined live creatives as needing re-embed
--                            (sets concept_at = NULL so the existing trigger /
--                             nightly backfill picks them up)
--   T1.1  products.text_embedding auto-embed trigger (re-embed on
--         name/brand/description/type/gender mutation when missing or stale)
--   T1.2  search_products_hybrid RPC over products (fallback supply pool
--         when creative pool is starved)
--   T1.4  search_backfill_attempts table for closed-loop observability
--   T1.5  search_query_misses view: include high-result-low-CTR queries
--
-- Safe to apply in one shot. No data-destructive changes; concept_at NULL'ing
-- only triggers re-embed which is idempotent.

-- ─────────────────────────────────────────────────────────────────────────────
-- T0.1 — product_types_canonical view
-- ─────────────────────────────────────────────────────────────────────────────
-- Edge functions read from here instead of hard-coding CANONICAL_TYPES so the
-- taxonomy can never drift from what's actually in the catalog.

create or replace view public.product_types_canonical as
  select
    p.type as type,
    count(*) filter (where p.is_active) as active_count,
    count(*) as total_count
  from public.products p
  where p.type is not null and btrim(p.type) <> ''
  group by p.type
  having count(*) filter (where p.is_active) >= 1
  order by 2 desc;

comment on view public.product_types_canonical is
  'Live source of truth for product type taxonomy. Edge functions read this to populate Haiku prompts and SQL filters — never hard-code the list.';

-- ─────────────────────────────────────────────────────────────────────────────
-- T0.2 — products.category column + auto-classify
-- ─────────────────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name='products' and column_name='category'
  ) then
    alter table public.products
      add column category text
      check (category in ('fashion','beauty','home','tech','lifestyle','other'));
    comment on column public.products.category is
      'Coarse product category. Routes embed-entity prompt selection so non-fashion items get accurate concept_docs.';
  end if;
end $$;

create index if not exists idx_products_category on public.products(category) where category is not null;

-- Heuristic classifier — runs on insert/update when category is NULL.
create or replace function public.infer_product_category(
  p_type text,
  p_name text,
  p_brand text,
  p_description text
) returns text
language plpgsql
immutable
as $$
declare
  v_corpus text := lower(coalesce(p_type,'') || ' ' || coalesce(p_name,'') || ' ' || coalesce(p_brand,'') || ' ' || coalesce(p_description,''));
begin
  -- Beauty / wellness
  if v_corpus ~ '\m(fragrance|perfume|cologne|skincare|haircare|hair cream|hair clay|shampoo|conditioner|lipstick|lip mask|moistur|serum|cleanser|sunscreen|makeup|cosmetic|toothpaste|toothbrush|tylenol|advil|vitamin|wellness|deodorant|body wash|lotion|mask|balm)\M' then
    return 'beauty';
  end if;
  -- Home
  if v_corpus ~ '\m(candle|coaster|furniture|decor|chair|sofa|table|lamp|rug|bedding|towel|cookware|kitchen|cutlery|plant|vase|frame|art print|mug|bowl|plate)\M' then
    return 'home';
  end if;
  -- Tech
  if v_corpus ~ '\m(phone|iphone|android|laptop|tablet|headphone|earbud|speaker|tv|monitor|camera|drone|gadget|cable|charger|smart watch|smartwatch)\M' then
    return 'tech';
  end if;
  -- Lifestyle (toys, books, pet, etc.)
  if v_corpus ~ '\m(toy|lego|puzzle|game|book|novel|pet|dog|cat|leash|treat|drink|coffee|tea|wine|snack|food|yoga mat)\M' then
    return 'lifestyle';
  end if;
  -- Fashion fallback — anything with garment / footwear / bag / accessory cues
  if v_corpus ~ '\m(shirt|tee|t-shirt|hoodie|sweater|jacket|coat|pant|jean|denim|short|skirt|dress|suit|legging|underwear|bra|swim|shoe|sneaker|boot|sandal|heel|loafer|hat|cap|beanie|scarf|sock|bag|tote|backpack|sunglass|watch|jewell?ery|necklace|bracelet|earring)\M' then
    return 'fashion';
  end if;
  return 'other';
end $$;

-- Backfill existing rows
update public.products
set category = public.infer_product_category(type, name, brand, description)
where category is null;

-- Trigger: keep category fresh on insert / when fields change
create or replace function public.products_set_category()
returns trigger
language plpgsql
as $$
begin
  if new.category is null then
    new.category := public.infer_product_category(new.type, new.name, new.brand, new.description);
  end if;
  return new;
end $$;

drop trigger if exists trg_products_set_category on public.products;
create trigger trg_products_set_category
  before insert or update of type, name, brand, description
  on public.products
  for each row
  when (new.category is null)
  execute function public.products_set_category();

-- ─────────────────────────────────────────────────────────────────────────────
-- T0.7 — query_embeddings TTL + version
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.query_embeddings
  add column if not exists embedding_v   integer not null default 1,
  add column if not exists expansion_v   integer not null default 1,
  add column if not exists expires_at    timestamptz;

comment on column public.query_embeddings.embedding_v is
  'Version stamp for the embedding model/prompt. Bump in code to invalidate cached vectors without deleting rows.';
comment on column public.query_embeddings.expansion_v is
  'Version stamp for the Haiku expansion prompt. Bump in code to invalidate cached expansions.';
comment on column public.query_embeddings.expires_at is
  'Hard TTL. nl-search ignores cached values past this timestamp.';

-- Default 30-day TTL on existing rows (so they get refreshed organically)
update public.query_embeddings
set expires_at = coalesce(expires_at, created_at + interval '30 days')
where expires_at is null;

create index if not exists idx_query_embeddings_expires_at
  on public.query_embeddings(expires_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- T0.8 — products mutation → flag joined creatives for re-embed
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.products_invalidate_creative_concepts()
returns trigger
language plpgsql
as $$
begin
  -- When the joined product changes in a way that affects the concept_doc,
  -- null out concept_at on every live creative so the auto-embed trigger /
  -- nightly backfill regenerates them.
  if (coalesce(new.name,'') is distinct from coalesce(old.name,'')
      or coalesce(new.brand,'') is distinct from coalesce(old.brand,'')
      or coalesce(new.description,'') is distinct from coalesce(old.description,'')
      or coalesce(new.type,'') is distinct from coalesce(old.type,'')
      or coalesce(new.gender,'') is distinct from coalesce(old.gender,'')
      or coalesce(new.category,'') is distinct from coalesce(old.category,''))
  then
    update public.product_creative
    set concept_at = null,
        text_embedding = null
    where product_id = new.id
      and status in ('live','done');
  end if;
  return new;
end $$;

drop trigger if exists trg_products_invalidate_creative_concepts on public.products;
create trigger trg_products_invalidate_creative_concepts
  after update of name, brand, description, type, gender, category
  on public.products
  for each row
  execute function public.products_invalidate_creative_concepts();

-- ─────────────────────────────────────────────────────────────────────────────
-- T1.1 — products.text_embedding auto-embed trigger
-- ─────────────────────────────────────────────────────────────────────────────
-- The product is itself searchable as a fallback when no creative exists.
-- Trigger fires when text_embedding is NULL on insert OR on relevant field
-- updates so we re-embed when the source content changes.

create or replace function public.notify_embed_product()
returns trigger
language plpgsql
security definer
as $$
declare
  v_token text;
begin
  -- Only embed active products with a name
  if new.is_active is not true or new.name is null or btrim(new.name) = '' then
    return new;
  end if;
  -- Skip if already embedded and source fields didn't change (UPDATE path)
  if tg_op = 'UPDATE'
     and new.text_embedding is not null
     and coalesce(new.name,'')        = coalesce(old.name,'')
     and coalesce(new.brand,'')       = coalesce(old.brand,'')
     and coalesce(new.description,'') = coalesce(old.description,'')
     and coalesce(new.type,'')        = coalesce(old.type,'')
     and coalesce(new.gender,'')      = coalesce(old.gender,'')
  then
    return new;
  end if;

  select decrypted_secret into v_token
    from vault.decrypted_secrets
    where name = 'embed_entity_service_key'
    limit 1;

  if v_token is null or v_token = 'PLACEHOLDER_REPLACE_VIA_DASHBOARD' then
    return new;
  end if;

  perform net.http_post(
    url     := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/embed-entity',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_token
    ),
    body    := jsonb_build_object(
      'id',          new.id,
      'entity_type', 'product',
      'force',       true
    )
  );
  return new;
end $$;

drop trigger if exists trg_products_auto_embed on public.products;
create trigger trg_products_auto_embed
  after insert or update of name, brand, description, type, gender, is_active
  on public.products
  for each row
  execute function public.notify_embed_product();

-- ─────────────────────────────────────────────────────────────────────────────
-- T1.2 — search_products_hybrid RPC (fallback supply pool)
-- ─────────────────────────────────────────────────────────────────────────────
-- Identical shape to search_creatives_hybrid output where possible, but with
-- product fields and NULL creative fields. nl-search merges results so the
-- client can render a "no video yet" tile when the field is null.

drop function if exists public.search_products_hybrid(vector, text, int, text, text[], boolean, uuid[]);

create or replace function public.search_products_hybrid(
  query_embedding vector(1536),
  query_text      text,
  k               int     default 24,
  filter_gender   text    default null,
  filter_types    text[]  default null,
  exclude_ids     uuid[]  default '{}'::uuid[]
)
returns table(
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
language sql
stable
as $$
  with candidates as (
    select p.id
    from public.products p
    where p.is_active = true
      and (filter_gender is null or p.gender is null or p.gender = filter_gender or p.gender = 'unisex')
      and (
        filter_types is null
        or array_length(filter_types, 1) is null
        or (p.type is not null and p.type = any(filter_types))
      )
      and (exclude_ids is null or array_length(exclude_ids, 1) is null or p.id <> all(exclude_ids))
  ),
  dense as (
    select
      c.id,
      row_number() over (order by p.text_embedding <=> query_embedding) as rk
    from candidates c
    join public.products p on p.id = c.id
    where p.text_embedding is not null
    order by p.text_embedding <=> query_embedding
    limit k * 4
  ),
  bm25 as (
    select
      c.id,
      row_number() over (
        order by ts_rank_cd(
          setweight(to_tsvector('english', coalesce(p.name,         '')), 'A') ||
          setweight(to_tsvector('english', coalesce(p.brand,        '')), 'B') ||
          setweight(to_tsvector('english', coalesce(p.type,         '')), 'B') ||
          setweight(to_tsvector('english', coalesce(p.description,  '')), 'C') ||
          setweight(to_tsvector('english', coalesce(p.concept_doc,  '')), 'B'),  -- 'B' not 'A' — see T0.6
          websearch_to_tsquery('english', query_text)
        ) desc
      ) as rk
    from candidates c
    join public.products p on p.id = c.id
    where coalesce(btrim(query_text), '') <> ''
      and (
        setweight(to_tsvector('english', coalesce(p.name,         '')), 'A') ||
        setweight(to_tsvector('english', coalesce(p.brand,        '')), 'B') ||
        setweight(to_tsvector('english', coalesce(p.type,         '')), 'B') ||
        setweight(to_tsvector('english', coalesce(p.description,  '')), 'C') ||
        setweight(to_tsvector('english', coalesce(p.concept_doc,  '')), 'B')
      ) @@ websearch_to_tsquery('english', query_text)
    limit k * 4
  ),
  fused as (
    select
      coalesce(d.id, b.id) as id,
      (coalesce(1.0 / (60.0 + d.rk), 0.0) +
       coalesce(1.0 / (60.0 + b.rk), 0.0))::double precision as rrf_score,
      d.rk as dense_rank,
      b.rk as bm25_rank
    from dense d
    full outer join bm25 b on d.id = b.id
    order by rrf_score desc
    limit k
  )
  select
    p.id,
    p.id           as product_id,
    null::text     as video_url,
    null::text     as thumbnail_url,
    null::text     as affiliate_url,
    null::numeric  as duration_seconds,
    p.is_elite,
    p.name         as product_name,
    p.brand        as product_brand,
    p.price        as product_price,
    p.image_url    as product_image_url,
    p.url          as product_url,
    p.gender       as product_gender,
    p.type         as product_type,
    p.concept_doc,
    p.concept_facets,
    f.rrf_score,
    f.dense_rank,
    f.bm25_rank
  from fused f
  join public.products p on p.id = f.id
  order by f.rrf_score desc;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T0.4 + T0.5 + T0.6 — search_creatives_hybrid v2:
--   • soft type filter (relax when pool < min_results)
--   • diversify by product_id (max max_per_product)
--   • lower concept_doc BM25 weight A → B
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.search_creatives_hybrid(vector, text, int, text, text[], boolean, uuid[]);

create or replace function public.search_creatives_hybrid(
  query_embedding   vector(1536),
  query_text        text,
  k                 int     default 24,
  filter_gender     text    default null,
  filter_types      text[]  default null,
  require_elite     boolean default false,
  exclude_ids       uuid[]  default '{}'::uuid[],
  min_results       int     default 8,
  max_per_product   int     default 2
)
returns table(
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
  bm25_rank         bigint,
  type_match        boolean
)
language plpgsql
stable
as $$
declare
  v_strict_count int;
  v_use_types text[] := filter_types;
begin
  -- Probe the strict pool. If it's smaller than min_results, drop the type
  -- filter and rely on dense/BM25 alone — better to surface adjacent
  -- categories than return an empty grid.
  if filter_types is not null and array_length(filter_types, 1) is not null then
    select count(*) into v_strict_count
    from public.product_creative pc
    join public.products p on p.id = pc.product_id
    where pc.status = 'live'
      and pc.enabled = true
      and pc.video_url is not null
      and p.is_active = true
      and (filter_gender is null or p.gender is null or p.gender = filter_gender or p.gender = 'unisex')
      and p.type = any(filter_types);

    if v_strict_count < min_results then
      v_use_types := null;  -- relax
    end if;
  end if;

  return query
  with candidates as (
    select pc.id, pc.product_id,
           (filter_types is not null
            and array_length(filter_types, 1) is not null
            and p.type = any(filter_types)) as type_match
    from public.product_creative pc
    join public.products p on p.id = pc.product_id
    where pc.status = 'live'
      and pc.enabled = true
      and pc.video_url is not null
      and p.is_active = true
      and (not require_elite or pc.is_elite = true)
      and (filter_gender is null or p.gender is null or p.gender = filter_gender or p.gender = 'unisex')
      and (
        v_use_types is null
        or array_length(v_use_types, 1) is null
        or (p.type is not null and p.type = any(v_use_types))
      )
      and (exclude_ids is null or array_length(exclude_ids, 1) is null or pc.id <> all(exclude_ids))
  ),
  dense as (
    select
      c.id,
      row_number() over (order by pc.text_embedding <=> query_embedding) as rk
    from candidates c
    join public.product_creative pc on pc.id = c.id
    where pc.text_embedding is not null
    order by pc.text_embedding <=> query_embedding
    limit k * 6
  ),
  bm25 as (
    select
      c.id,
      row_number() over (
        order by ts_rank_cd(
          setweight(to_tsvector('english', coalesce(p.name,         '')), 'A') ||
          setweight(to_tsvector('english', coalesce(p.brand,        '')), 'B') ||
          setweight(to_tsvector('english', coalesce(p.type,         '')), 'B') ||
          setweight(to_tsvector('english', coalesce(p.description,  '')), 'C') ||
          setweight(to_tsvector('english', coalesce(pc.concept_doc, '')), 'B'),  -- T0.6: A → B
          websearch_to_tsquery('english', query_text)
        ) desc
      ) as rk
    from candidates c
    join public.product_creative pc on pc.id = c.id
    join public.products p          on p.id  = c.product_id
    where coalesce(btrim(query_text), '') <> ''
      and (
        setweight(to_tsvector('english', coalesce(p.name,         '')), 'A') ||
        setweight(to_tsvector('english', coalesce(p.brand,        '')), 'B') ||
        setweight(to_tsvector('english', coalesce(p.type,         '')), 'B') ||
        setweight(to_tsvector('english', coalesce(p.description,  '')), 'C') ||
        setweight(to_tsvector('english', coalesce(pc.concept_doc, '')), 'B')
      ) @@ websearch_to_tsquery('english', query_text)
    limit k * 6
  ),
  fused as (
    select
      coalesce(d.id, b.id) as id,
      (coalesce(1.0 / (60.0 + d.rk), 0.0) +
       coalesce(1.0 / (60.0 + b.rk), 0.0))::double precision as rrf_score,
      d.rk as dense_rank,
      b.rk as bm25_rank
    from dense d
    full outer join bm25 b on d.id = b.id
  ),
  -- T0.5 diversification: cap each product to max_per_product creatives,
  -- preferring type-matching creatives first when we relaxed.
  ranked as (
    select
      f.id, f.rrf_score, f.dense_rank, f.bm25_rank,
      pc.product_id,
      c.type_match,
      row_number() over (
        partition by pc.product_id
        order by (case when c.type_match then 1 else 0 end) desc, f.rrf_score desc
      ) as per_product_rank
    from fused f
    join public.product_creative pc on pc.id = f.id
    join candidates c on c.id = f.id
  ),
  diversified as (
    select * from ranked
    where ranked.per_product_rank <= greatest(max_per_product, 1)
    order by
      -- type-matched results win the tiebreak when the strict pool is small
      (case when ranked.type_match then 0 else 1 end),
      ranked.rrf_score desc
    limit k
  )
  select
    pc.id,
    pc.product_id,
    pc.video_url,
    pc.thumbnail_url,
    pc.affiliate_url,
    pc.duration_seconds,
    pc.is_elite,
    p.name        as product_name,
    p.brand       as product_brand,
    p.price       as product_price,
    p.image_url   as product_image_url,
    p.url         as product_url,
    p.gender      as product_gender,
    p.type        as product_type,
    pc.concept_doc,
    pc.concept_facets,
    di.rrf_score,
    di.dense_rank,
    di.bm25_rank,
    di.type_match
  from diversified di
  join public.product_creative pc on pc.id = di.id
  join public.products p          on p.id  = pc.product_id
  order by
    (case when di.type_match then 0 else 1 end),
    di.rrf_score desc;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T1.4 — search_backfill_attempts observability
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.search_backfill_attempts (
  id                  uuid primary key default gen_random_uuid(),
  search_query_id     uuid references public.search_queries(id) on delete set null,
  raw_query           text not null,
  catalog_label       text,
  brainstormed_count  int  not null default 0,
  brainstormed        jsonb,
  search_calls        int  not null default 0,
  products_inserted   int  not null default 0,
  errors              jsonb,
  attempted_at        timestamptz not null default now(),
  duration_ms         int,
  outcome             text check (outcome in ('done','skipped','error'))
);

comment on table public.search_backfill_attempts is
  'Closed-loop observability: every search-backfill run writes one row per miss it processed so ops can diagnose conversion failures.';

create index if not exists idx_search_backfill_attempts_query_id on public.search_backfill_attempts(search_query_id);
create index if not exists idx_search_backfill_attempts_at on public.search_backfill_attempts(attempted_at desc);

alter table public.search_backfill_attempts enable row level security;
drop policy if exists "Service write search_backfill_attempts" on public.search_backfill_attempts;
create policy "Service write search_backfill_attempts" on public.search_backfill_attempts
  for all using (auth.role() = 'service_role');
drop policy if exists "Authenticated read search_backfill_attempts" on public.search_backfill_attempts;
create policy "Authenticated read search_backfill_attempts" on public.search_backfill_attempts
  for select using (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────────────────────────────────────
-- T1.5 — expand search_query_misses to include semantic-quality misses
-- ─────────────────────────────────────────────────────────────────────────────
-- Old criteria: result_count < 3 OR top_score < 0.015
-- New criteria adds: served_count >= 3 AND clicked_count = 0 (interaction
-- proxy — high-result low-CTR queries are quality misses).
--
-- search_queries today doesn't track clicked_count; we derive it from a
-- LEFT JOIN to a future search_query_clicks table if it exists, otherwise
-- it's simply 0 and the new branch is dormant until clicks are wired.

create table if not exists public.search_query_clicks (
  id              uuid primary key default gen_random_uuid(),
  search_query_id uuid not null references public.search_queries(id) on delete cascade,
  creative_id     uuid,
  product_id      uuid,
  position        int,
  clicked_at      timestamptz not null default now()
);
create index if not exists idx_search_query_clicks_query_id on public.search_query_clicks(search_query_id);

alter table public.search_query_clicks enable row level security;
drop policy if exists "Anyone insert search_query_clicks" on public.search_query_clicks;
create policy "Anyone insert search_query_clicks" on public.search_query_clicks
  for insert with check (true);
drop policy if exists "Authenticated read search_query_clicks" on public.search_query_clicks;
create policy "Authenticated read search_query_clicks" on public.search_query_clicks
  for select using (auth.role() = 'authenticated' or auth.role() = 'service_role');

-- Replace the view
drop view if exists public.search_query_misses;
create view public.search_query_misses as
  with click_counts as (
    select search_query_id, count(*) as clicks
    from public.search_query_clicks
    group by search_query_id
  )
  select
    sq.id,
    sq.raw_query,
    sq.normalized_query,
    sq.query_plan,
    sq.result_count,
    sq.top_score,
    sq.user_id,
    sq.session_id,
    sq.backfill_status,
    sq.served_count,
    coalesce(cc.clicks, 0) as click_count,
    sq.created_at,
    sq.updated_at,
    case
      when sq.result_count < 3                 then 'cold'
      when sq.top_score is null                then 'cold'
      when sq.top_score < 0.015                then 'low_score'
      when sq.served_count >= 3 and coalesce(cc.clicks, 0) = 0 then 'no_engagement'
      else 'unknown'
    end as miss_reason
  from public.search_queries sq
  left join click_counts cc on cc.search_query_id = sq.id
  where sq.backfill_status = 'none'
    and (
      sq.result_count < 3
      or sq.top_score is null
      or sq.top_score < 0.015
      or (sq.served_count >= 3 and coalesce(cc.clicks, 0) = 0)
    )
  order by sq.served_count desc, sq.created_at desc;

comment on view public.search_query_misses is
  'Cold misses + low-score + no-engagement queries. Closed-loop backfill agent reads from here.';

-- ─────────────────────────────────────────────────────────────────────────────
-- DONE
-- ─────────────────────────────────────────────────────────────────────────────
