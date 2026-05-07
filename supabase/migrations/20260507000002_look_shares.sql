-- Public-share rows for an exported user_generation. Each row holds
-- a unique slug (the public URL surface), the source generation, and
-- the watermarked video URL once Modal finishes baking the wordmark
-- onto it. status drives the polling UI on the Export modal.

create table if not exists public.look_shares (
  id                       uuid primary key default gen_random_uuid(),
  -- Short URL-safe slug. 10 base32-ish chars = ~50 bits, plenty
  -- against guessing for share links. Unique constraint.
  slug                     text unique not null,
  generation_id            uuid not null references public.user_generations(id) on delete cascade,
  created_by               uuid not null references auth.users(id) on delete cascade,
  -- Populated once the Modal worker uploads the watermarked render
  -- to the look-media bucket.
  watermarked_video_url    text,
  watermarked_storage_path text,
  status                   text not null default 'pending'
                              check (status in ('pending','rendering','done','failed')),
  error                    text,
  created_at               timestamptz not null default now(),
  rendered_at              timestamptz
);

create index if not exists look_shares_generation_idx on public.look_shares(generation_id);
create index if not exists look_shares_created_by_idx on public.look_shares(created_by);

alter table public.look_shares enable row level security;

create policy look_shares_public_read
  on public.look_shares
  for select
  using (true);

create policy look_shares_owner_insert
  on public.look_shares
  for insert
  with check (
    auth.uid() = created_by
    and exists (
      select 1 from public.user_generations g
      where g.id = generation_id and g.user_id = auth.uid()
    )
  );

create policy look_shares_owner_delete
  on public.look_shares
  for delete
  using (auth.uid() = created_by);
