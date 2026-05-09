-- Style feature
--
-- Adds:
--   1. app_settings admin write policy so the new /admin/prompts page can
--      upsert the foundational style prompt without service-role.
--   2. Seed the default `style_prompt` value (the editable foundational
--      template the edge function fills in per request).
--   3. style_generations table — one row per shopper's style request,
--      mirroring user_generations (status, occasion, prompt, model, etc).
--   4. style_generation_images — 4 rows per generation (2 gpt-image-1, 2
--      nano-banana-2), each carrying its provider, image_url and error.

-- ── 1. app_settings admin-write policy ──────────────────────────────────────
-- The seed migration only allowed service_role writes; admin-driven prompt
-- edits from the dashboard need authenticated admin upserts. Adds a SELECT
-- policy for authenticated users too so admins can read freshly-written
-- rows back without anon caching quirks.

drop policy if exists app_settings_admin_write on public.app_settings;
create policy app_settings_admin_write on public.app_settings
  for all to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  )
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- ── 2. Seed the foundational style prompt ───────────────────────────────────
-- Placeholders (substituted in the edge function):
--   {{gender}}    "guy" | "girl" | "person"
--   {{name}}      profile.full_name (or "this person")
--   {{height}}    profile.height_label (e.g. 5'10")
--   {{age}}       profile.age_label    (e.g. mid 20s)
--   {{pronoun}}   "he" | "she" | "they"
--   {{occasion}}  the user's free-text input from the Style page

insert into public.app_settings (key, value)
values (
  'style_prompt',
  $$Make a style reference sheet for this {{gender}}, {{name}}, height {{height}} {{age}} years old, show amazing outfits {{pronoun}} can wear on {{occasion}}, but {{pronoun}}'s not trying too hard. Photo realistic. Don't show text$$
)
on conflict (key) do nothing;

-- ── 3. style_generations ────────────────────────────────────────────────────

create table if not exists public.style_generations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  status          text not null default 'pending'
                  check (status in ('pending', 'generating', 'done', 'failed')),
  occasion        text not null,
  -- Snapshotted from profiles at submission time so a later profile edit
  -- doesn't retroactively rewrite the prompt history.
  gender          text,
  name            text,
  height_label    text,
  age_label       text,
  -- The fully-resolved prompt that was sent to the providers (post
  -- placeholder substitution). Stored verbatim for debugging + audit.
  resolved_prompt text,
  reference_urls  text[] not null default '{}',
  error           text,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index if not exists style_generations_user_created_idx
  on public.style_generations (user_id, created_at desc);

alter table public.style_generations enable row level security;

drop policy if exists style_generations_owner_rw on public.style_generations;
create policy style_generations_owner_rw on public.style_generations
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists style_generations_admin_read on public.style_generations;
create policy style_generations_admin_read on public.style_generations
  for select to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- ── 4. style_generation_images ──────────────────────────────────────────────

create table if not exists public.style_generation_images (
  id            uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.style_generations(id) on delete cascade,
  provider      text not null check (provider in ('gpt-image-1', 'nano-banana-2')),
  -- 0..3 — render order in the 2x2 grid. 0,1 = gpt-image-1; 2,3 = nano-banana-2.
  sort_order    int  not null,
  status        text not null default 'pending'
                check (status in ('pending', 'done', 'failed')),
  image_url     text,
  error         text,
  created_at    timestamptz not null default now(),
  unique (generation_id, sort_order)
);

create index if not exists style_generation_images_gen_idx
  on public.style_generation_images (generation_id, sort_order);

alter table public.style_generation_images enable row level security;

-- Owner sees their own images via the parent row's user_id. We deliberately
-- denormalize the access check through a join to style_generations so the
-- pivot table doesn't need its own user_id column.
drop policy if exists style_generation_images_owner_select on public.style_generation_images;
create policy style_generation_images_owner_select on public.style_generation_images
  for select to authenticated
  using (
    exists (
      select 1 from public.style_generations g
      where g.id = generation_id and g.user_id = auth.uid()
    )
  );

drop policy if exists style_generation_images_admin_read on public.style_generation_images;
create policy style_generation_images_admin_read on public.style_generation_images
  for select to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- Writes happen exclusively from the generate-style edge function via
-- service-role, so no INSERT/UPDATE policy for end users. service_role
-- bypasses RLS by default.
