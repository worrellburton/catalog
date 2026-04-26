-- 045: Creative tables — restructure to product_creative + looks_creative
--
-- Introduces parallel "creative" tables that decouple rendered video assets
-- from the entity tables (products, looks). Adds vector(1024) embedding
-- columns for nearest-neighbour visual + text search.
--
--   products  ──►  product_creative   (supersedes product_ads)
--   looks     ──►  looks_creative     (extracted from looks.video_path/etc.)
--
-- This migration is NON-DESTRUCTIVE. The old product_ads table and the
-- video_path/thumbnail_url/assembly_prompt/ai_assembled columns on looks
-- are left in place so existing code keeps working until the cutover is
-- verified live. A follow-up migration drops them.
--
-- Webhook triggers for the Modal worker are intentionally NOT installed
-- here; they are added in a separate migration alongside the worker code
-- update (see Phase 6 of the cutover plan).

-- ============================================================================
-- product_creative
-- ============================================================================

create table if not exists product_creative (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid not null references products(id) on delete cascade,

  -- Creative content
  title             text,
  description       text,
  video_url         text,
  storage_path      text,
  thumbnail_url     text,
  affiliate_url     text,

  -- Generation parameters
  prompt            text,
  prompt_extra      text,
  style             text not null default 'studio_clean',
  model             text default 'veo-3.1-fast-generate-preview',
  duration_seconds  numeric default 4,
  aspect_ratio      text default '9:16',
  resolution        text default '720p',

  -- Lifecycle
  status            text not null default 'pending'
                      check (status in ('pending','generating','done','failed','live','paused')),
  enabled           boolean default false,
  error             text,
  cost_usd          numeric,
  completed_at      timestamptz,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),

  -- Engagement
  impressions       integer default 0,
  clicks            integer default 0,

  -- Curation (ad-specific)
  is_elite          boolean not null default false,
  boosted_until     timestamptz,

  -- Vector search
  embedding         vector(1024),
  embedding_model   text,
  embedded_at       timestamptz
);

comment on table  product_creative                 is 'AI-generated video creative for a single product. Supersedes product_ads.';
comment on column product_creative.model           is 'Renamed from veo_model — stores any model identifier (veo, seedance, etc.).';
comment on column product_creative.embedding       is 'Multimodal vector for nearest-neighbour search. NULL until embedding pipeline runs.';
comment on column product_creative.embedding_model is 'Model that produced the embedding (e.g. cohere-embed-v4-1024). Used to detect stale vectors.';
comment on column product_creative.embedded_at    is 'When the current embedding was computed. NULL = never embedded.';

create index if not exists idx_product_creative_product   on product_creative(product_id);
create index if not exists idx_product_creative_status    on product_creative(status);
create index if not exists idx_product_creative_enabled   on product_creative(enabled) where enabled = true;
create index if not exists idx_product_creative_is_elite  on product_creative(is_elite) where is_elite = true;
-- HNSW index intentionally deferred until backfill (empty index = wasted work).

alter table product_creative enable row level security;

create policy "Public read product_creative" on product_creative
  for select using (true);

create policy "Service write product_creative" on product_creative
  for all using (auth.role() = 'service_role');

create policy "Authenticated write product_creative" on product_creative
  for all using (auth.role() = 'authenticated');

create trigger set_product_creative_updated_at
  before update on product_creative
  for each row execute function update_updated_at();

-- Atomic counter RPCs (parallel to increment_ad_impressions / increment_ad_clicks)
create or replace function increment_product_creative_impressions(creative_id uuid)
returns void language plpgsql security definer as $$
begin
  update product_creative set impressions = impressions + 1 where id = creative_id;
end;
$$;

create or replace function increment_product_creative_clicks(creative_id uuid)
returns void language plpgsql security definer as $$
begin
  update product_creative set clicks = clicks + 1 where id = creative_id;
end;
$$;

-- ============================================================================
-- looks_creative
-- ============================================================================

create table if not exists looks_creative (
  id                uuid primary key default gen_random_uuid(),
  look_id           uuid not null references looks(id) on delete cascade,

  -- Creative content
  title             text,
  description       text,
  video_url         text,
  storage_path      text,
  thumbnail_url     text,

  -- Generation parameters
  prompt            text,
  prompt_extra      text,
  style             text default 'studio_clean',
  model             text,
  duration_seconds  numeric,
  aspect_ratio      text default '9:16',
  resolution        text default '720p',

  -- Lifecycle
  status            text not null default 'pending'
                      check (status in ('pending','generating','done','failed','live','paused')),
  enabled           boolean default true,
  error             text,
  cost_usd          numeric,
  completed_at      timestamptz,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),

  -- Engagement
  impressions       integer default 0,
  clicks            integer default 0,

  -- Look-specific: marks the canonical creative shown for the look.
  -- A look may have many creative variants (e.g. AI re-renderings); exactly
  -- one is_primary at a time, enforced by partial unique index below.
  is_primary        boolean not null default false,

  -- Vector search
  embedding         vector(1024),
  embedding_model   text,
  embedded_at       timestamptz
);

comment on table  looks_creative              is 'Video creative for a look. Extracted from looks.video_path/thumbnail_url. Supports multiple variants per look via is_primary.';
comment on column looks_creative.is_primary  is 'Exactly one true value per look_id (partial unique index). The primary creative is what consumer-facing UIs display.';
comment on column looks_creative.embedding   is 'Multimodal vector for nearest-neighbour search. NULL until embedding pipeline runs.';

create index if not exists idx_looks_creative_look    on looks_creative(look_id);
create index if not exists idx_looks_creative_status  on looks_creative(status);
create index if not exists idx_looks_creative_enabled on looks_creative(enabled) where enabled = true;

create unique index if not exists looks_creative_one_primary_per_look
  on looks_creative(look_id) where is_primary;

alter table looks_creative enable row level security;

create policy "Public read looks_creative" on looks_creative
  for select using (true);

create policy "Service write looks_creative" on looks_creative
  for all using (auth.role() = 'service_role');

create policy "Authenticated write looks_creative" on looks_creative
  for all using (auth.role() = 'authenticated');

create trigger set_looks_creative_updated_at
  before update on looks_creative
  for each row execute function update_updated_at();

create or replace function increment_looks_creative_impressions(creative_id uuid)
returns void language plpgsql security definer as $$
begin
  update looks_creative set impressions = impressions + 1 where id = creative_id;
end;
$$;

create or replace function increment_looks_creative_clicks(creative_id uuid)
returns void language plpgsql security definer as $$
begin
  update looks_creative set clicks = clicks + 1 where id = creative_id;
end;
$$;

-- ============================================================================
-- DATA MIGRATION
-- ============================================================================

-- Junk cleanup: 5 draft looks with no real content (titles 'dsadas', 'asa',
-- 'dasdas'). Confirmed by inventory: status='draft', no video, no thumbnail.
delete from looks
 where status = 'draft'
   and video_path is null
   and thumbnail_url is null
   and title in ('dsadas', 'asa', 'dasdas');

-- product_ads → product_creative (preserves UUIDs)
insert into product_creative (
  id, product_id, title, description, video_url, storage_path, thumbnail_url,
  affiliate_url, prompt, prompt_extra, style, model, duration_seconds,
  aspect_ratio, resolution, status, enabled, error, cost_usd, completed_at,
  created_at, updated_at, impressions, clicks, is_elite, boosted_until
)
select
  id, product_id, title, description, video_url, storage_path, thumbnail_url,
  affiliate_url, prompt, prompt_extra, style, veo_model, duration_seconds,
  aspect_ratio, resolution, status, enabled, error, cost_usd, completed_at,
  created_at, updated_at, impressions, clicks, is_elite, boosted_until
from product_ads
on conflict (id) do nothing;

-- looks (with video) → looks_creative as the primary creative for each look
insert into looks_creative (
  look_id, video_url, thumbnail_url, prompt,
  status, enabled, is_primary, created_at, updated_at
)
select
  id,
  video_path,
  thumbnail_url,
  assembly_prompt,
  case when status = 'live' then 'live' else 'done' end,
  coalesce(enabled, true),
  true,
  coalesce(created_at, now()),
  coalesce(updated_at, now())
from looks
where video_path is not null
on conflict do nothing;
