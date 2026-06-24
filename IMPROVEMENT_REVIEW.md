# Catalog — Product Improvement Review
**Branch:** `main` · **Reviewed:** 2026-06-24 · **Reviewer:** Claude Sonnet 4.6

Sources examined: `CLAUDE.md`, `docs/daily-feed.md`, `docs/PENDING_QUEUE.md`,
`docs/VIBE_AESTHETIC_SEARCH_PLAN.md`, `supabase/functions/embed-product/index.ts`,
`supabase/functions/haiku-context/index.ts`, `supabase/functions/affiliate-sync/index.ts`,
`supabase/migrations/082_search_v3_clean.sql` (trg_products_auto_embed),
`supabase/migrations/20260612010000_haiku_context.sql`,
`supabase/migrations/20260618000000_haiku_context_backfill_cron.sql`,
`app/services/personalized-feed.ts`, `app/services/seen-feed.ts`,
`app/services/looks.ts` (fetchSeenLookIds),
`app/components/ContinuousFeed.tsx`, `app/components/FollowingRail.tsx`,
`app/services/affiliate.ts`, and recent git log.

Compared against prior review (2026-06-22) to confirm novelty. Items #1 and #2
are new since that review. Items #3 and #4 were flagged then and remain open.

---

## 1 · haiku\_context is generated for every product but never enters the search index

**The gap:** The `haiku-context` edge function writes a two-line visual description
to `products.haiku_context` (line 1: plain-language category, e.g. "potted plant";
line 2: colour + materials, e.g. "deep green, waxy leaves with architectural form").
A cron fires every 10 minutes to backfill this for all products that have a primary
image. The column is already read by `AIStylist.tsx`, `type-governance.ts`, and
`genders.ts` — but **neither `embed-product/buildDoc()` nor `product_occasions_text()`
reads it**. Search (both the semantic/embedding path and the BM25 path) is blind to
the visual description entirely.

The compounding problem: `trg_products_auto_embed` fires on
`after insert or update of name, brand, type, description, is_active` (migration
`082_search_v3_clean.sql:321`) — `haiku_context` is absent from the column list.
So when the backfill cron sets `haiku_context` on a product that already has an
embedding, the auto-embed trigger never fires. The product's search vector was
built before the visual description existed and is never updated.

**Why it matters:** The design intent for `haiku_context` was precisely to correct
cases where the scraped product name misleads (e.g. "Men's Low-Top Sneaker" being
mapped wrong, or a "ZZ Plant" matching beauty products). That correction is applied
for taxonomy and gender inference, but the embedding — the signal the search RPC
uses for semantic matching — still reflects the pre-haiku text. Shoppers who search
for "potted plant", "ankle strap heel", or "oversized canvas" get rankings that
ignore the clearest visual evidence for those terms.

**Next steps:**

1. In `supabase/functions/embed-product/index.ts`: add `haiku_context` to the
   `buildDoc()` SELECT and to the `parts` assembly (after `materials_care`, before
   the enriched fields).
2. In a new migration: add `haiku_context` to the trigger column list, and in
   `notify_embed_product()` pass `force: true` when
   `NEW.haiku_context IS DISTINCT FROM OLD.haiku_context` so the trigger overwrites
   an existing embedding rather than skipping it.
3. Run a one-shot batch re-embed scoped to
   `where haiku_context is not null and embedded_at < haiku_context_at` — these are
   the products whose embedding predates the visual description.

---

## 2 · Three separate `user_events` round trips fire on every feed mount

**The gap:** On mount, the consumer home page makes three independent Supabase
queries for seen-state, with no shared cache:

| Component | Call | Query |
|---|---|---|
| `ContinuousFeed.tsx:317` | `fetchSeenLookIds(user.id)` | `user_events` direct select — look UUIDs → `reorderBySeen` |
| `ContinuousFeed.tsx:355` | `getSeenKeys()` | `user_seen_keys()` RPC — look + product keys → `partitionUnseen` |
| `FollowingRail.tsx:115` | `fetchSeenLookIds(user.id)` | same `user_events` query again → unseen badge counts |

`fetchSeenLookIds` has no caching — every call fires a fresh `user_events`
query (up to 50 k rows). `FollowingRail` calls it independently of `ContinuousFeed`,
so the query runs twice on every cold page load. `getSeenKeys()` is a third trip.
All three read `user_events` impressions for the same user.

**Why it matters:** On a slow connection or for a power user with many impressions,
this is three waterfalls in the critical render path. The redundancy also makes the
"same order every visit" symptom harder to debug — three look-seen signals means
three places to check when the seen state appears stale. The `PENDING_QUEUE.md`
reports this symptom but the redundant queries are an underappreciated contributor.

**Next steps:** Add a session-level cache to `fetchSeenLookIds` (same pattern as
`looksPromise` / `creatorsPromise` in `looks.ts` — a module-level `Promise | null`
keyed on `userId` that clears on auth change and when a new impression fires via
`subscribeToLooksChange`). `FollowingRail` can then call the cached function and
get the in-flight result instead of racing a fresh query. Longer-term: decide
whether `getSeenKeys()` (which overlaps on looks) and `fetchSeenLookIds` should be
unified into one query — the prior review (2026-06-22 §3) has the full analysis.

---

## 3 · `daily-feed.md` describes shipped features as open improvements

**The gap:** `docs/daily-feed.md` (the canonical Daily Feed reference) still says
in its "Known nuance" section:

> Today, the daily re-rank reorders **products**; looks keep the unified `feed_rank`
> order (plus seen-decay). … Making the **head** visibly rotate each day (a
> date-seeded rotation) and extending the daily re-rank to **looks** are the two
> open improvements.

Both shipped. `applyDailyRotation` was added to `personalize-feed/index.ts`
(commit `cb52a72`, 2026-06-23) for the look lead, and the personalize-feed engine
already re-ranks looks per shopper. The "open improvements" paragraph now describes
completed work.

**Why it matters:** `daily-feed.md` is the first document a new session or
contributor reads to understand what the engine does. Finding "open improvements"
that are already live will cause future sessions to re-investigate or attempt to
re-implement them. The `PENDING_QUEUE` has already drifted from this doc.

**Next step:** Update `docs/daily-feed.md`: remove the "open improvements" sentence
from "Known nuance", update the "What it is" description to confirm that both
products and looks are now re-ranked per shopper, and add a one-liner on the daily
lead rotation (applyDailyRotation, pool=18, step=7, ~18-day cycle).

---

## 4 · Feed type-clustering spec has no scope decision

**The gap:** `PENDING_QUEUE.md §Feed ordering algorithm` specifies that the seen
portion of the feed should be "clustered by type — all shoes together, then all
shirts, etc. Grouped random, NOT pure random" and closes with "STILL NEEDS A
DECISION: feed type-clustering (product grid?)." This was also open in the
2026-06-22 review (§4).

The ambiguity is concrete: `reorderBySeen` operates on looks (which contain
multiple product types — clustering by type doesn't map cleanly), while
`partitionUnseen` hides seen products entirely rather than shuffling them. No
current code path produces a shuffled-seen product section to cluster. The spec
as written targets a surface that doesn't exist.

**Why it matters:** The open decision is a small drain on every future session that
reads the queue — it reads as a pending TODO when it's actually a product choice.
If the answer is "we hide seen products, not shuffle them" (which is what the code
does), the spec should be removed. If a shuffled-seen product section is genuinely
wanted, it needs a design.

**Next step:** Make the decision explicit in `PENDING_QUEUE.md`. Option A: remove
the type-clustering spec (current hide-and-reset is correct; no shuffled-seen
section will be built). Option B: scope it explicitly to a future "you've seen it
all" product section and write the target UX. Either closes the recurring
re-derivation cost.
