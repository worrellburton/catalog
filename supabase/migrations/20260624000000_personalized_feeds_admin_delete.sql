-- Allow admins to DELETE personalized_feeds rows.
--
-- personalized_feeds is a regenerable per-shopper/day cache written by the
-- personalize-feed edge function (service role). RLS previously exposed only
-- SELECT (own + admin), so the admin "Advance to next daily feed" action
-- could bump the epoch but could NOT clear already-computed rows for the new
-- day — the engine is idempotent per (user_id, feed_date), so any pre-existing
-- row for that date was served stale. This policy lets the admin UI bust that
-- server-side cache on Advance so every shopper recomputes fresh.
--
-- Scoped to the same admin check as personalized_feeds_select_admin.
create policy personalized_feeds_delete_admin on public.personalized_feeds
  for delete to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.is_admin = true or p.role = any (array['admin', 'super_admin']))
    )
  );
