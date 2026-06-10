-- Broadcast app_settings changes over Realtime so shared settings (e.g.
-- the financial model assumptions on /admin/model) sync live across every
-- open admin session. Guarded so re-running is a no-op.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'app_settings'
  ) then
    alter publication supabase_realtime add table public.app_settings;
  end if;
end $$;
