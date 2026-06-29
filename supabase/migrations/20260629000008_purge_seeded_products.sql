-- Catalog Seeding — one-call purge of seeded products (the revert/cleanup path).
-- Every seeded product is flagged source='seed_serpapi'; deleting them is
-- FK-safe (all products FKs CASCADE or SET NULL — verified). is_admin gated.
-- See docs/CATALOG_SEEDING.md.

create or replace function public.purge_seeded_products()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;
  delete from public.products where source = 'seed_serpapi';
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function public.purge_seeded_products() to authenticated, service_role;
