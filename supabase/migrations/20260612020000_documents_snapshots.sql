-- Document snapshots (applied via MCP): the business plan generator
-- stores its latest HTML under key 'business-plan'; /plan serves it
-- publicly behind a client passcode.
create table if not exists public.documents (
  key text primary key,
  html text not null,
  updated_at timestamptz not null default now()
);
alter table public.documents enable row level security;
drop policy if exists "documents public read" on public.documents;
create policy "documents public read" on public.documents
  for select to anon, authenticated using (true);
drop policy if exists "documents admin write" on public.documents;
create policy "documents admin write" on public.documents
  for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin))
  with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin));
