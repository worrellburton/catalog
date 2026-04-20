-- Phase 2 of the catalog-driven feed rebuild.
--
-- Adds a first-class `catalogs` table so a catalog slug is a real DB row
-- (not a loose string), seeds it with the existing suggestion list, and
-- adds GIN indexes on the catalog_tags jsonb columns so filtering the
-- feed by a catalog slug is fast even at scale.
--
-- Shape:
--   catalogs(slug text pk, name text, sort int, is_featured bool, description text, created_at)
--   looks.catalog_tags    -- already exists as jsonb — just indexed here
--   products.catalog_tags -- already exists as jsonb — just indexed here

create table if not exists public.catalogs (
  slug         text primary key,
  name         text not null,
  description  text,
  sort         int  not null default 0,
  is_featured  boolean not null default false,
  created_at   timestamptz not null default now()
);

comment on table public.catalogs is
  'Registry of browsable catalogs (vibes). Looks and products reference these by slug via catalog_tags.';

-- Seed the known catalog suggestions so the picker has real rows to pick
-- from on first boot. Matches the hard-coded list in app/data/looks.ts
-- searchSuggestions. Safe to re-run (no-op on conflict).
insert into public.catalogs (slug, name, sort, is_featured) values
  ('old-money-style',      'old money style',     1, true),
  ('quiet-luxury',         'quiet luxury',        2, true),
  ('main-character-energy','main character energy', 3, true),
  ('clean-girl-aesthetic', 'clean girl aesthetic', 4, true),
  ('off-duty-model',       'off duty model',      5, true),
  ('first-date-fit',       'first date fit',      6, true),
  ('date-night-outfit',    'date night outfit',   7, true),
  ('wedding-guest-dress',  'wedding guest dress', 8, true),
  ('matcha-everything',    'matcha everything',   9, true),
  ('cozy-fall-vibes',      'cozy fall vibes',    10, true),
  ('beach-day',            'beach day',          11, true),
  ('summer-dresses',       'summer dresses',     12, true),
  ('omg-shoes',            'omg shoes',          13, true),
  ('make-me-hot',          'make me hot',        14, true),
  ('brunch-outfit',        'brunch outfit',      15, true),
  ('skincare-routine',     'skincare routine',   16, true),
  ('festival-looks',       'festival looks',     17, true),
  ('vintage-finds',        'vintage finds',      18, true),
  ('pilates-princess',     'pilates princess',   19, true)
on conflict (slug) do nothing;

-- GIN indexes on the jsonb catalog_tags columns. "jsonb_path_ops" is the
-- smaller, faster index when the only query shape is containment
-- (catalog_tags @> '[...]') — which is exactly what the feed service uses.
create index if not exists looks_catalog_tags_gin
  on public.looks using gin (catalog_tags jsonb_path_ops);

create index if not exists products_catalog_tags_gin
  on public.products using gin (catalog_tags jsonb_path_ops);

-- Helper: upsert a catalog from a human-typed name. Callers pass the
-- display name; the function derives the slug, leaves it unchanged if
-- it already exists.
create or replace function public.ensure_catalog(display_name text)
returns text language plpgsql as $$
declare
  _slug text;
begin
  _slug := lower(regexp_replace(trim(display_name), '[^a-z0-9]+', '-', 'gi'));
  _slug := trim(both '-' from _slug);
  if _slug = '' then return null; end if;
  insert into public.catalogs (slug, name)
       values (_slug, display_name)
       on conflict (slug) do nothing;
  return _slug;
end;
$$;
