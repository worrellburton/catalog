-- Gemini-generated, per-look description, cached so the look overlay doesn't
-- re-call the model on every view. Each look gets its OWN unique blurb: the
-- `look-description` edge function sends Gemini the look's poster frame plus
-- the products featured in it, so the copy is grounded in the actual image and
-- the actual items (not a generic creator-level summary).
--
-- Keyed by look_id (looks.id uuid). Public-readable like creator_about_summaries;
-- writes happen only through the edge function (service role bypasses RLS).
create table if not exists public.look_descriptions (
  look_id uuid primary key references public.looks(id) on delete cascade,
  description text not null,
  source text,
  generated_at timestamptz not null default now()
);

alter table public.look_descriptions enable row level security;

drop policy if exists look_descriptions_read on public.look_descriptions;
create policy look_descriptions_read on public.look_descriptions
  for select using (true);
