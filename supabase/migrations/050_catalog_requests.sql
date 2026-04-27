-- 050: catalog_requests — "I want this catalog" social-proof counter.
--
-- When a shopper searches for a catalog that has no live creatives yet, we
-- show an empty state with a button. Each press increments a counter for
-- that catalog slug. The count is shown live (Supabase realtime sub on the
-- same row) so the number ticks up when other shoppers press it too.

create table if not exists catalog_requests (
  catalog_slug text primary key,
  count        integer not null default 0,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

alter table catalog_requests enable row level security;

create policy "Public read catalog_requests"
  on catalog_requests for select using (true);

-- Writes go through the RPC below (security definer), so we don't need
-- direct insert/update grants on the table itself.

create or replace function request_catalog(slug text)
returns integer
language plpgsql
security definer
as $$
declare
  new_count integer;
  clean_slug text;
begin
  -- Normalize: lowercase + collapse whitespace + trim. Two shoppers searching
  -- "Y2K" and "y2k" should land on the same row.
  clean_slug := lower(btrim(regexp_replace(slug, '\s+', ' ', 'g')));
  if clean_slug = '' then
    raise exception 'slug required';
  end if;

  insert into catalog_requests (catalog_slug, count)
       values (clean_slug, 1)
  on conflict (catalog_slug) do update
       set count = catalog_requests.count + 1,
           updated_at = now()
  returning count into new_count;

  return new_count;
end;
$$;

grant execute on function request_catalog(text) to anon, authenticated;

-- Enable realtime updates so the counter ticks live when another shopper
-- presses the button.
alter publication supabase_realtime add table catalog_requests;
