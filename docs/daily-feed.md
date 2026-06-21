# Daily Feed — canonical concept

**"Daily Feed" is the single, canonical name for each shopper's own
custom home feed and everything that produces it.** When anyone says
"Daily Feed," this is what they mean. Use this term in code comments,
PRs, admin UI, and conversation — not the older internal aliases.

## What it is

Every signed-in shopper gets their **own** home feed, re-ranked to their
taste, that **rolls over once per day** (at a configurable UTC hour). No
two shoppers see the same order. The countdown a shopper sees ("Your next
feed drops in HH:MM:SS") is the time until the next daily rollover.

How an order is produced for a shopper/day:

1. **Candidate pool + baseline order** — the `home` catalog curated in
   `/admin/catalogs` (looks + products share one unified `feed_rank`).
   This is what a brand-new shopper (cold start) sees.
2. **Deterministic re-rank** from the shopper's recent `user_events`
   (engaged brands/types, already-seen items decayed), scored by the
   **Feed Rules** (ten founder-tunable, weighted 0–10 signals).
3. **Claude re-rank** (`claude-opus-4-8`) of the top slice into the final
   order. Falls back to the deterministic order if the model is
   unavailable.
4. Result is **cached once per `(user, day)`**; a holdout slice and
   cold-start users fall back to the global feed (recorded for measurement).

Today, the daily re-rank reorders **products**; looks keep the unified
`feed_rank` order (plus seen-decay). See "Known nuance" below.

## Where it lives (name map)

Historically the engine was called the **"Automatic Editor"** and the
implementation is prefixed **`personalize` / `personalized`**. Those
names still exist in code identifiers (renaming the deployed edge
function, table, and cron is risky and not worth it), but they all mean
**Daily Feed**:

| Layer | Identifier | Notes |
|---|---|---|
| Consumer surface | "Your daily feed" hero + countdown | `app/components/home/ShoppingForHero.tsx` |
| Engine (edge fn) | `personalize-feed` | `supabase/functions/personalize-feed/index.ts` — builds + caches the per-user/day order |
| Client service | `getPersonalizedProductOrder()` | `app/services/personalized-feed.ts` — invokes/caches today's order |
| Storage | `personalized_feeds` table | one row per `(user_id, feed_date)`: `ranked_items`, `variant`, `model`, `reason` |
| Config (dials) | `auto_editor_*` in `app_settings` | enabled / frequency / holdout_pct / recency_days / min_signal / refresh_hour — read via `getAutoEditorConfig()` (`app/services/dials.ts`) |
| Ranking knobs | **Feed Rules** (`feed_rules` JSON, `FeedRules`) | ten weighted signals, `app/services/dials.ts` |
| Admin: settings | "Daily Feed" button + modal | `/admin/catalogs` (was labeled "Automatic Editor") |
| Admin: inspect | `DailyFeedLens`, `DailyFeedPreview` | render the feed AS a chosen user; movement badges vs. baseline |
| Unified order | `feed_rank` + `apply_feed_order(ordered_keys[])` | looks + products in ONE rank space (the `/admin/catalogs` FEED arrangement) |

## Admin controls

- **Curate the pool + baseline:** `/admin/catalogs` → the `home` catalog
  (drag looks and products into one order → `apply_feed_order`).
- **Turn it on / tune it:** the **Daily Feed** button on the home catalog
  → master toggle, frequency, holdout %, recency, min-signal, refresh
  hour, and the Feed Rules weights.
- **Inspect a shopper's feed:** **Preview feed** → type a username to
  render their live Daily Feed with movement badges vs. the baseline.

## Known nuance (kept here so it isn't rediscovered)

The daily re-rank currently reorders **products only**; looks keep the
unified `feed_rank`. And for a shopper with very stable tastes the *head*
of the order can repeat day-to-day (the strongest-affinity items lead
every day) even though the tail rotates — so the change can be hard to
see above the fold. Making the **head** visibly rotate each day (a
date-seeded rotation) and extending the daily re-rank to **looks** are
the two open improvements.
