-- Document share links: admin-minted URLs (/d/<slug>) each carrying its
-- own passcode. The public viewer never reads the table directly — it
-- goes through the security-definer RPC, which checks the passcode,
-- bumps the view counter and returns the snapshot HTML.
create table if not exists public.document_shares (
  id uuid primary key default gen_random_uuid(),
  doc_key text not null default 'business-plan',
  slug text not null unique,
  label text,
  passcode text not null,
  revoked boolean not null default false,
  views integer not null default 0,
  last_viewed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.document_shares enable row level security;
drop policy if exists "document_shares admin all" on public.document_shares;
create policy "document_shares admin all" on public.document_shares
  for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin))
  with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin));

create or replace function public.open_document_share(p_slug text, p_pass text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  s public.document_shares%rowtype;
  doc_html text;
begin
  select * into s from public.document_shares
    where slug = lower(trim(p_slug)) and revoked = false
      and lower(passcode) = lower(trim(p_pass))
    limit 1;
  if s.id is null then
    return null;
  end if;
  update public.document_shares
    set views = views + 1, last_viewed_at = now()
    where id = s.id;
  select html into doc_html from public.documents where key = s.doc_key;
  return doc_html;
end $$;
revoke all on function public.open_document_share(text, text) from public;
grant execute on function public.open_document_share(text, text) to anon, authenticated;
