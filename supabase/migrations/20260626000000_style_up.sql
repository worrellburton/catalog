-- Style Up — AI stylist chat (admin-gated v1).
--
-- A shopper requests a stylist from a roster, then has an ongoing, realtime
-- chat where the stylist sends product picks and on-you renders. v1 stylists
-- are AI personas; the schema is agnostic so a human-stylist console can write
-- the same `stylist`-sender rows later.
--
--   style_up_stylists  — the roster of stylist profiles (AI personas in v1)
--   style_up_threads   — one ongoing conversation per (shopper, stylist)
--   style_up_messages  — chat log: text / product card / on-you render

-- ── Stylist roster ─────────────────────────────────────────────────────
create table if not exists public.style_up_stylists (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  avatar_url    text,
  specialty     text,                       -- short tagline, e.g. "Quiet luxury & tailoring"
  bio           text,
  persona_prompt text,                      -- system steer for the AI stylist
  accent_color  text,                       -- chat accent (hex) for the stylist's bubbles
  is_active     boolean not null default true,
  sort          int not null default 0,
  created_at    timestamptz not null default now()
);

-- ── Threads ────────────────────────────────────────────────────────────
create table if not exists public.style_up_threads (
  id              uuid primary key default gen_random_uuid(),
  shopper_user_id uuid not null references public.profiles(id) on delete cascade,
  stylist_id      uuid not null references public.style_up_stylists(id) on delete cascade,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  unique (shopper_user_id, stylist_id)       -- one ongoing thread per pairing
);
create index if not exists style_up_threads_shopper_idx
  on public.style_up_threads (shopper_user_id, last_message_at desc);

-- ── Messages ───────────────────────────────────────────────────────────
create table if not exists public.style_up_messages (
  id                   uuid primary key default gen_random_uuid(),
  thread_id            uuid not null references public.style_up_threads(id) on delete cascade,
  sender               text not null check (sender in ('shopper','stylist')),
  kind                 text not null default 'text' check (kind in ('text','product','render')),
  body                 text,                 -- chat text (or caption for product/render)
  product_ref          jsonb,               -- { id?, name, brand, image, price, url } for product/render
  render_generation_id uuid,                 -- user_generations.id for an on-you render bubble
  created_at           timestamptz not null default now()
);
create index if not exists style_up_messages_thread_idx
  on public.style_up_messages (thread_id, created_at);

-- ── RLS ────────────────────────────────────────────────────────────────
alter table public.style_up_stylists enable row level security;
alter table public.style_up_threads  enable row level security;
alter table public.style_up_messages enable row level security;

-- Roster: any signed-in user can read it; admins manage it.
drop policy if exists style_up_stylists_read on public.style_up_stylists;
create policy style_up_stylists_read on public.style_up_stylists
  for select using (true);
drop policy if exists style_up_stylists_admin on public.style_up_stylists;
create policy style_up_stylists_admin on public.style_up_stylists
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid()
                 and (p.is_admin = true or p.role in ('admin','super_admin'))))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid()
                 and (p.is_admin = true or p.role in ('admin','super_admin'))));

-- Threads: a shopper owns their own threads; admins see all.
drop policy if exists style_up_threads_owner on public.style_up_threads;
create policy style_up_threads_owner on public.style_up_threads
  for all
  using (shopper_user_id = auth.uid()
         or exists (select 1 from public.profiles p where p.id = auth.uid()
                    and (p.is_admin = true or p.role in ('admin','super_admin'))))
  with check (shopper_user_id = auth.uid()
         or exists (select 1 from public.profiles p where p.id = auth.uid()
                    and (p.is_admin = true or p.role in ('admin','super_admin'))));

-- Messages: scoped through the owning thread.
drop policy if exists style_up_messages_owner on public.style_up_messages;
create policy style_up_messages_owner on public.style_up_messages
  for all
  using (exists (select 1 from public.style_up_threads t
                 where t.id = thread_id
                 and (t.shopper_user_id = auth.uid()
                      or exists (select 1 from public.profiles p where p.id = auth.uid()
                                 and (p.is_admin = true or p.role in ('admin','super_admin'))))))
  with check (exists (select 1 from public.style_up_threads t
                 where t.id = thread_id
                 and (t.shopper_user_id = auth.uid()
                      or exists (select 1 from public.profiles p where p.id = auth.uid()
                                 and (p.is_admin = true or p.role in ('admin','super_admin'))))));

-- Realtime: the chat view subscribes to message inserts + typing presence.
alter publication supabase_realtime add table public.style_up_messages;

-- ── Seed AI stylist personas ───────────────────────────────────────────
insert into public.style_up_stylists (name, specialty, bio, persona_prompt, accent_color, sort)
values
  ('Margot', 'Quiet luxury & tailoring',
   'Clean lines, elevated basics, and pieces that last. Margot dresses you like money that doesn''t talk.',
   'You are Margot, a warm, decisive personal stylist who favors quiet luxury: tailored, timeless, high-quality basics in a muted palette. Ask sharp clarifying questions, then recommend specific pieces with a short reason each.',
   '#b9a07a', 1),
  ('Devon', 'Streetwear & sneakers',
   'Hype-aware but wearable. Devon builds fits around the right sneaker and a strong silhouette.',
   'You are Devon, an energetic streetwear stylist who builds outfits around footwear and silhouette. Keep it current but wearable; recommend specific pieces with a punchy one-line reason each.',
   '#6ea8fe', 2),
  ('Sofia', 'Date-night & occasion',
   'Knows how to make a moment. Sofia styles you for the night you''re actually having.',
   'You are Sofia, a confident occasion stylist who dresses people for dates, events, and nights out. Read the vibe, then recommend specific pieces with a short, flattering reason each.',
   '#e08aa8', 3);
