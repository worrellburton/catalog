-- Catalog admin music library. Mirrors the Looks/Products tab in the
-- admin Data view: searchable, sortable list of tracks the platform has
-- onboarded. Source of truth is Spotify (spotify_track_id + the metadata
-- cached locally so the consumer feed never needs a live Spotify call).
-- Down-stream link tables (looks_music, creators_music) can join on
-- musics.id when that feature lands.

create table if not exists public.musics (
  id                 uuid primary key default gen_random_uuid(),
  spotify_track_id   text unique not null,
  name               text not null,
  artist             text,
  album              text,
  image_url          text,
  thumbnail_url      text,
  preview_url        text,
  external_url       text,
  duration_ms        integer,
  explicit           boolean default false,
  popularity         integer,
  added_by           uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists musics_created_at_idx on public.musics (created_at desc);
create index if not exists musics_name_trgm       on public.musics using gin (name   gin_trgm_ops);
create index if not exists musics_artist_trgm     on public.musics using gin (artist gin_trgm_ops);

alter table public.musics enable row level security;

drop policy if exists musics_select_all on public.musics;
create policy musics_select_all on public.musics
  for select to anon, authenticated using (true);

drop policy if exists musics_insert_admin on public.musics;
create policy musics_insert_admin on public.musics
  for insert to authenticated
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.is_admin = true or p.role in ('admin','super_admin'))
  ));

drop policy if exists musics_update_admin on public.musics;
create policy musics_update_admin on public.musics
  for update to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.is_admin = true or p.role in ('admin','super_admin'))
  ));

drop policy if exists musics_delete_admin on public.musics;
create policy musics_delete_admin on public.musics
  for delete to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.is_admin = true or p.role in ('admin','super_admin'))
  ));

create or replace function public.musics_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_musics_touch on public.musics;
create trigger trg_musics_touch before update on public.musics
  for each row execute function public.musics_touch_updated_at();
