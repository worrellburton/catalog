# Catalog — Improvement Review

**Date:** 2026-06-23  
**Branch reviewed:** `main` (read-only)  
**Reviewed by:** Claude Sonnet 4.6

Sources consulted: `CLAUDE.md`, `docs/daily-feed.md`, `docs/VIBE_AESTHETIC_SEARCH_PLAN.md`,
`docs/SEARCH_ENRICHMENT_PLAN.md`, `docs/BACKFILL_STATUS.md`, `docs/PENDING_QUEUE.md`,
`supabase/functions/personalize-feed/index.ts`, `app/services/personalized-feed.ts`,
`app/services/session-tracker.ts`, `app/services/seen-feed.ts`, `app/services/looks.ts`,
`app/components/ContinuousFeed.tsx`, `app/components/LookCard.tsx`,
migrations `20260603000001–20260608000001`, recent `git log --oneline -30`.

---

## 1. Aesthetic search Phase 2 — style data will re-pollute as the catalog grows

**Problem.** The V8 aesthetic route (`search_products`, migrations `20260605000007–9`)
correctly fixes `"quiet luxury" → candles` today by filtering candidates to
`taxonomy.category ∈ APPAREL_DEPARTMENT` before BM25 ranking. But the underlying
data is still wrong: `agents/product-scraper/modal_app.py::generate_taxonomy_and_styling`
emits a free-text `taxonomy.style` string without any department constraint, so new
products keep arriving with dept-blind labels ("minimal luxury" on a laptop, on a
cashmere coat). `product_occasions_text()` (migration `20260603000001`) feeds that
raw string directly into the BM25 doc: `coalesce(taxonomy->>'style','')`. The V8
department gate papers over the existing pollution; it does nothing to stop the next
scrape batch re-introducing it.

The VIBE_AESTHETIC_SEARCH_PLAN.md §5 specifies the actual fix — a **controlled
`style[]` vocabulary** applied only to apparel — but it was never built. The plan's
own §7 flags this: "when the controlled `style[]`/occasion vocab lands, update the
`generate_taxonomy_and_styling` prompt … so new products are born compliant.
Otherwise the backfill drifts out of date."

**Why it matters.** The aesthetic route is stable today but becomes less precise as
catalog size grows. The current `style` signal in the BM25 doc is noisy enough that
V8 chose to bypass it entirely (apparel filter + query expansion rather than style
matching). Phase 2 would make `style[]` a real ranking signal, eliminating the
bypass dependency and improving precision at every catalog size.

**Next step.** Run `scripts/enrich-aesthetics.mjs` (described in VIBE_AESTHETIC_SEARCH_PLAN.md §5.3 — needs to be written, mirrors `enrich-occasions-v2.mjs`): a Haiku
pass over all apparel/footwear/accessories that replaces free-text style with 1–3
values from the controlled vocab (quiet luxury · old money · streetwear · clean girl ·
coastal grandma · y2k · coquette · gorpcore · minimalist · classic tailoring · athleisure ·
bohemian · edgy · preppy · workwear). In the same PR, update
`modal_app.py::generate_taxonomy_and_styling` to emit the controlled `style[]` on
new scrapes. Estimated: ~1 day, ~$0.10 Haiku cost for backfill.

---

## 2. Daily Feed holdout is unmeasurable at event level

**Problem.** The `personalize-feed` edge function deterministically assigns shoppers
to a `personalized` or `holdout` variant (10% holdout by default, tunable) and stores
the assignment in `personalized_feeds.variant`. But `user_events` carries no variant
field. The only way to measure holdout vs. personalized performance is a fuzzy
date-join: link every impression/click a user fires on a given day to whichever variant
they were assigned that morning. That answers "did personalized users click more on
average?" but not "which specific placements drove the lift?" or "does the
`engagedBrands` rule help the sub-segment with 3–10 events?"

The `context` column in `user_events` already exists and is already passed through
`session-tracker.ts::emit()` as `target.context`. In the consumer code, it's never
populated — `LookCard.tsx` and `ContinuousFeed.tsx` pass no `context` argument to
`trackImpression`.

**Why it matters.** The Daily Feed is the product's most complex feature and the one
with the most tuning surface (10 Feed Rules, holdout %, recency window, Claude re-rank
top-N). Without event-level variant tagging, the only feedback loop is gut feel. The
holdout exists; the measurement doesn't.

**Next step.** In `app/services/personalized-feed.ts`, after `compute()` resolves,
write the variant to sessionStorage (`catalog:feed-variant:v1:{userId}:{date}`).
Expose it via a `getFeedVariant()` getter. In `app/components/LookCard.tsx` (the
impression fire path, line ~222), call `getFeedVariant()` and pass it as `context:
\`df:${variant}\`` on `trackImpression`. ~30 lines across two files, no schema
change.

---

## 3. Orphaned description-enrichment artifacts signal a live backfill that does nothing

**Problem.** `docs/BACKFILL_STATUS.md` says "🏃 IN PROGRESS" on a May 2026 run that
enriched ~45 of 790 products (5.7%) with AI-generated lifestyle phrases written into
`products.description`. That column is **not in the search document** — migration
`20260603000002` dropped it from the BM25 tsvector explicitly (the VIBE_AESTHETIC_SEARCH_PLAN.md §3 cites this: "the description approach re-introduces term-dilution
that got `description` dropped"). The current `search_products` builds its BM25 doc
from `name`, `product_occasions_text()`, `brand`, and `type` — never `description`.
The enriched text on those 45 products has zero effect on search.

The live artifacts are:
- `supabase/migrations/089_add_description_enriched_flag.sql` — adds `description_enriched boolean` + partial index
- `scripts/enrich-all-descriptions.mjs` and `scripts/reembed-enriched-products.mjs` — checked-in backfill runners
- `docs/BACKFILL_STATUS.md` — says "IN PROGRESS" against a superseded approach
- `docs/SEARCH_ENRICHMENT_PLAN.md` — presents the enrichment approach as the design

A developer reading BACKFILL_STATUS.md today would reasonably try to complete the
backfill. The VIBE_AESTHETIC_SEARCH_PLAN.md exists but is labeled "Proposed" (it was
shipped in V8, but the plan doc was never updated to reflect that either).

**Next step.** (a) Add a one-line tombstone header to `docs/BACKFILL_STATUS.md` and
`docs/SEARCH_ENRICHMENT_PLAN.md`: "Approach superseded by V8 aesthetic routing — see
VIBE_AESTHETIC_SEARCH_PLAN.md. Do not resume." (b) Drop the `description_enriched`
column in a new timestamped migration. (c) Delete the two backfill scripts. (d) Update
`docs/VIBE_AESTHETIC_SEARCH_PLAN.md` status from "Proposed" to "Phase 1 shipped
(20260605000009); Phase 2–3 pending." Total effort: ~30 min.

---

## 4. Two parallel `user_events` round trips on every home feed mount

**Problem.** `ContinuousFeed.tsx` fires two independent reads against `user_events`
on every mount, both load-path critical for the feed's opening order:

| Line | Call | Result | Used for |
|---|---|---|---|
| 317 | `fetchSeenLookIds(user.id)` | Direct `.from('user_events')` select; returns `Set<string>` (look UUIDs) | `reorderBySeen()` — orders seen looks last |
| 355 | `getSeenKeys()` | `supabase.rpc('user_seen_keys')` → reads `user_events` server-side; returns `Set<SeenKey>` | `partitionUnseen()` — hides already-seen items |

Both queries hit the same table, both block first-paint ordering, and both are
non-batched. The distinction is real (ordering vs. hiding, looks vs. products), but
the underlying data is identical impression rows — and currently the `user_seen_keys`
RPC only returns seen items, not their types in a way that would let one call serve
both paths without changes.

On a real mobile session, each Supabase RPC takes 200–400 ms. The two calls can
overlap (both are fired concurrently via separate `useEffect`s), but the feed
rendering waits on both via their respective `useMemo` dependencies.

**Why it matters.** Consolidating into one RPC that returns `{target_type, target_uuid}`
for all seen item types eliminates one database round trip from the critical path for
every authenticated home feed load, and removes the maintenance surface where two seen
systems must stay in sync independently.

**Next step.** Update the `user_seen_keys` RPC (currently returning look keys, see
`app/services/seen-feed.ts:24`) to return both look and product seen keys in one
query. In `ContinuousFeed.tsx`, replace the two `useEffect` fetches with one that
calls the updated RPC, then derives both `seenLookIds` (Set of UUIDs for
`reorderBySeen`) and `seenKeys` (Set of SeenKey strings for `partitionUnseen`) from
the single result. Changes confined to the RPC definition, `seen-feed.ts`, and
~15 lines in `ContinuousFeed.tsx`.

---

*Feed type-clustering (PENDING_QUEUE.md §"Feed ordering algorithm") was evaluated but
excluded: the queue itself flags the target surface as ambiguous ("reorderBySeen
operates on LOOKS, not products — confirm target before building") and this review
found no surface where a clustered shuffle is currently happening but wrong; it needs
a design decision, not a code suggestion.*

*Look re-ranking expansion (`daily-feed.md` says "extending the daily re-rank to looks
is an open improvement") was also evaluated: looks are already re-ranked in the edge
function via `rankLooks()` at `personalize-feed/index.ts:533`, with `applyDailyRotation`,
`applyDailyShuffle`, and `derangeAgainstPrev` applied. The `daily-feed.md` doc is
stale on this point — a one-line update to that doc, not a feature.*
