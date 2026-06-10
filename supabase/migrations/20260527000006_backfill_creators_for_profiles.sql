-- Backfill: every profile (AI or human) without a creators row gets
-- one so they're follow-able and so looks.creator_handle can be
-- synced via the existing looks_sync_creator_handle trigger. Handle
-- is slugified from full_name (or "user-<8 hex>" fallback) and made
-- unique by appending a numeric suffix on conflict.

create or replace function public._slugify_handle(src text)
returns text
language plpgsql
immutable
as $$
declare
  v text := lower(coalesce(src, ''));
begin
  v := regexp_replace(v, '[^a-z0-9]+', '-', 'g');
  v := regexp_replace(v, '-{2,}', '-', 'g');
  v := regexp_replace(v, '^-+|-+$', '', 'g');
  return v;
end;
$$;

do $$
declare
  rec record;
  base_handle text;
  candidate text;
  suffix int;
begin
  for rec in
    select p.id, p.full_name, p.email, p.avatar_url, coalesce(p.is_ai, false) as is_ai
      from public.profiles p
      left join public.creators c on c.id = p.id
     where c.id is null
  loop
    base_handle := public._slugify_handle(coalesce(rec.full_name, split_part(rec.email, '@', 1)));
    if base_handle is null or length(base_handle) = 0 then
      base_handle := 'user-' || substr(rec.id::text, 1, 8);
    end if;

    candidate := base_handle;
    suffix := 1;
    while exists (select 1 from public.creators where handle = candidate) loop
      suffix := suffix + 1;
      candidate := base_handle || '-' || suffix::text;
    end loop;

    insert into public.creators (id, handle, display_name, avatar_url, is_ai, created_at)
    values (
      rec.id,
      candidate,
      coalesce(nullif(rec.full_name, ''), candidate),
      rec.avatar_url,
      rec.is_ai,
      now()
    );
  end loop;
end $$;

update public.looks l
   set creator_handle = c.handle
  from public.creators c
 where l.user_id = c.id
   and (l.creator_handle is null or l.creator_handle = '');
