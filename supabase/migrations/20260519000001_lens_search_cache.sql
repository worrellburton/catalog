-- Phase 9 of the Style → Shop this look pipeline.
--
-- Two-table cache for the lens-search edge function so reopening the
-- same Style image (or a previously-cropped region) returns the
-- previously-fetched Google Lens visual matches without paying SerpAPI
-- a second time. Results are deterministic per (image_url + text hint
-- + bbox + country) tuple so a sha256 of that tuple is the natural
-- cache key.
--
-- Also tracks which results were actually ingested into public.products
-- (Phase 6 of the build plan) so the Style sheet can surface "already
-- tried on" badges without an extra join through the products table.

-- ── 1. lens_searches ────────────────────────────────────────────────────────
create table if not exists public.lens_searches (
  id                uuid primary key default gen_random_uuid(),
  -- The user who triggered the search, kept for analytics / abuse
  -- attribution. Cache hits are shared across all users so this is
  -- nullable (later searches for the same fingerprint won't overwrite
  -- the original requester).
  user_id           uuid references auth.users(id) on delete set null,
  source_image_url  text not null,
  q                 text not null default '',
  -- Optional bbox crop of the source image (Phase 3). Stored as
  -- {x, y, w, h} in 0..1 normalized image space so it survives
  -- resizes / reprocessing. Null when the whole image was scanned.
  bbox              jsonb,
  -- sha256 of `${source_image_url}|${q}|${bbox_json}|${country}` so
  -- the edge function can dedupe identical searches without parsing
  -- the components back out.
  fingerprint       text not null unique,
  result_count      int  not null default 0,
  country           text not null default 'us',
  created_at        timestamptz not null default now()
);

create index if not exists lens_searches_fingerprint_idx
  on public.lens_searches (fingerprint);
create index if not exists lens_searches_user_created_idx
  on public.lens_searches (user_id, created_at desc);

alter table public.lens_searches enable row level security;

-- Read access: any authenticated user can read any cache row so the
-- cross-user shared cache pays off. Writes only via service-role from
-- the lens-search edge function.
drop policy if exists lens_searches_read on public.lens_searches;
create policy lens_searches_read on public.lens_searches
  for select to authenticated using (true);

-- ── 2. lens_results ─────────────────────────────────────────────────────────
create table if not exists public.lens_results (
  id                   uuid primary key default gen_random_uuid(),
  search_id            uuid not null references public.lens_searches(id) on delete cascade,
  position             int  not null,
  title                text not null,
  source               text,
  source_icon          text,
  link                 text not null,
  thumbnail            text,
  image                text,
  price                text,
  brand                text,
  rating               numeric,
  reviews              int,
  -- When the user later picks this result and lens-ingest writes it
  -- into public.products, we patch this column so reopening the
  -- lens sheet can show an "already in your catalog" badge.
  ingested_product_id  uuid references public.products(id) on delete set null,
  created_at           timestamptz not null default now()
);

create index if not exists lens_results_search_idx
  on public.lens_results (search_id, position);
create index if not exists lens_results_link_idx
  on public.lens_results (link);

alter table public.lens_results enable row level security;

drop policy if exists lens_results_read on public.lens_results;
create policy lens_results_read on public.lens_results
  for select to authenticated using (true);
