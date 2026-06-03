-- Add looks + looks_creative to the supabase_realtime publication so
-- the consumer feed's postgres_changes channel actually receives
-- INSERT/UPDATE/DELETE events. Without these, an admin's delete or
-- unpublish would only become visible on the next shopper refresh.
--
-- Now: every admin mutation propagates live across every connected
-- shopper tab — looks vanish from the feed the moment they're
-- deleted, freshly-published rows pop in, and Unpublish from the
-- admin Published tab clears the row from the consumer feed without
-- a reload.

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'looks'
  ) then
    execute 'alter publication supabase_realtime add table public.looks';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'looks_creative'
  ) then
    execute 'alter publication supabase_realtime add table public.looks_creative';
  end if;
end $$;
