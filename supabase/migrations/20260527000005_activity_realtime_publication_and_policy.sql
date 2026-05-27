-- Activity stream — realtime engagement notifications for creators.
-- Two pieces:
--   1. RLS policy that lets a creator read user_events targeting one
--      of their own looks. The existing owner_select policy only
--      allowed the event's actor to read it, so the creator never
--      saw clicks/clickouts on their own content via realtime.
--   2. Publication membership for user_events + creator_follows so
--      postgres_changes subscriptions deliver INSERT events.

create policy "user_events_creator_target_select"
  on public.user_events
  for select
  using (
    target_type = 'look'
    and exists (
      select 1
        from public.looks l
       where l.id = user_events.target_uuid
         and l.user_id = auth.uid()
    )
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'user_events'
  ) then
    execute 'alter publication supabase_realtime add table public.user_events';
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'creator_follows'
  ) then
    execute 'alter publication supabase_realtime add table public.creator_follows';
  end if;
end $$;
