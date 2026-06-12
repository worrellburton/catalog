-- Right password + no published snapshot used to return null — the
-- viewer showed "wrong password" (founder hit exactly this). Return a
-- marker instead so the client can say what's actually going on, and
-- only count views that really saw the document.
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
  select html into doc_html from public.documents where key = s.doc_key;
  if doc_html is null then
    return '__NO_DOC__';
  end if;
  update public.document_shares
    set views = views + 1, last_viewed_at = now()
    where id = s.id;
  return doc_html;
end $$;
