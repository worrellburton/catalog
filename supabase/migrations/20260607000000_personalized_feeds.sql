-- Automatic Editor — per-user daily personalized feed.
--
-- Stores one ranked feed per (user, calendar day). The order is computed
-- lazily on the shopper's first visit of the day by the `personalize-feed`
-- edge function (service role), which builds a candidate set from the
-- shopper's user_events history + embedding/affinity signals and has Claude
-- re-rank the top slice. ContinuousFeed reads today's row and re-orders the
-- live Home feed in place; a missing/`fallback`/`holdout` row falls back to
-- the global feed_rank order, so editorial control is never lost.
--
-- variant:
--   'personalized' — Claude-re-ranked order in ranked_items
--   'fallback'     — too little history; serve the global feed (logged for analytics)
--   'holdout'      — control group; serve the global feed (logged for analytics)
create table if not exists public.personalized_feeds (
  user_id      uuid        not null references auth.users(id) on delete cascade,
  feed_date    date        not null,
  ranked_items jsonb       not null default '[]'::jsonb,  -- ordered [{ "type": "product"|"look", "id": "..." }]
  variant      text        not null default 'personalized',
  model        text,
  reason       jsonb,                                     -- optional per-feed rationale (admin "why")
  computed_at  timestamptz not null default now(),
  primary key (user_id, feed_date),
  constraint personalized_feeds_variant_chk
    check (variant in ('personalized', 'fallback', 'holdout'))
);

alter table public.personalized_feeds enable row level security;

-- Owner-only read. Writes are performed exclusively by the edge function
-- using the service role (which bypasses RLS), so no user write policy.
drop policy if exists "personalized_feeds_select_own" on public.personalized_feeds;
create policy "personalized_feeds_select_own" on public.personalized_feeds
  for select using (auth.uid() = user_id);

-- Admin read (super-admins inspect any user's feed for the "why" view).
drop policy if exists "personalized_feeds_select_admin" on public.personalized_feeds;
create policy "personalized_feeds_select_admin" on public.personalized_feeds
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and (p.is_admin = true or p.role in ('admin', 'super_admin'))
    )
  );

-- Seed the Automatic Editor config dials (app_settings key/value text store).
-- These are read via services/dials.ts; missing rows already fall back to the
-- defaults in code, but seeding makes them visible/editable in the admin UI.
insert into public.app_settings (key, value) values
  ('auto_editor_enabled',      'false'),  -- master on/off (starts OFF)
  ('auto_editor_frequency',    'daily'),  -- 'daily' | 'every_signin'
  ('auto_editor_holdout_pct',  '10'),     -- % of eligible shoppers kept on the global feed as control
  ('auto_editor_recency_days', '30'),     -- history lookback window for signals
  ('auto_editor_min_signal',   '3')       -- min user_events before we personalize (else fallback)
on conflict (key) do nothing;
