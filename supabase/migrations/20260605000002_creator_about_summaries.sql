-- Claude-generated "about" blurb per creator, cached so the About tab
-- doesn't re-call the model on every view. Keyed by handle (works for
-- real handles and synthetic user:<uuid> owner keys alike).
create table if not exists public.creator_about_summaries (
  handle text primary key,
  summary text not null,
  generated_at timestamptz not null default now()
);

alter table public.creator_about_summaries enable row level security;

-- About blurbs are public-facing, so anyone can read the cache. Writes
-- happen only through the edge function (service role bypasses RLS), so
-- there is intentionally no insert/update policy for anon/authenticated.
drop policy if exists creator_about_read on public.creator_about_summaries;
create policy creator_about_read on public.creator_about_summaries
  for select using (true);
