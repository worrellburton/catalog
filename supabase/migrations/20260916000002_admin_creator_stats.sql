-- Per-creator product and look counts for the admin creator list.
--
-- Replaces two unbounded client-side selects that tallied in the browser.
-- PostgREST silently caps a response at 1000 rows, and this feature imports
-- roughly 425 products per ShopMy creator - so creator_products crossed that
-- cap at the third import and the counts would have under-reported with no
-- error at all.

create or replace function public.admin_creator_stats()
returns table (creator_handle text, products bigint, looks bigint)
language sql
stable
security definer
set search_path to 'public'
as $$
  select c.handle,
         (select count(*) from public.creator_products cp where cp.creator_handle = c.handle),
         (select count(*) from public.looks l where l.creator_handle = c.handle)
    from public.creators c;
$$;

revoke all on function public.admin_creator_stats() from public, anon;
grant execute on function public.admin_creator_stats() to authenticated, service_role;
