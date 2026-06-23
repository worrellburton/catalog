# Catalog — Product Improvement Review
**Branch:** `main` · **Reviewed:** 2026-06-22 · **Reviewer:** Claude Sonnet 4.6

Sources examined: `CLAUDE.md`, `docs/daily-feed.md`, `docs/PENDING_QUEUE.md`,
`docs/VIBE_AESTHETIC_SEARCH_PLAN.md`, `docs/SEARCH_ENRICHMENT_PLAN.md`,
`docs/BACKFILL_STATUS.md`, `supabase/functions/personalize-feed/index.ts`,
`app/services/personalized-feed.ts`, `app/services/looks.ts`,
`app/services/seen-feed.ts`, `app/services/feed-compose.ts`,
`app/services/user-affinity.ts`, `app/components/ContinuousFeed.tsx`,
`app/components/LookCard.tsx`, `tests/search/eval-relevance.mjs`,
`supabase/migrations/20260603000002*.sql`,
`supabase/migrations/20260601000001_user_seen_keys_rpc.sql`,
and recent git log.

---

## 1 · Ship aesthetic search Phase 1 — the eval gate is already failing

**The gap:** `VIBE_AESTHETIC_SEARCH_PLAN.md` documents a department-aware routing
fix for queries like `quiet luxury` and `old money`. Status is marked "Proposed."
`tests/search/eval-relevance.mjs` already has hard `allowedTypes: APPAREL`
assertions for those queries, meaning `npm run eval:search` exits non-zero today.
The route (`search_products`) currently has no aesthetic intent detection, so
`quiet luxury` degrades to matching the literal token `luxury` — surfacing candles,
face cream, and a laptop rather than fashion — and `old money` hits one result:
a finance book.

**Why it matters:** These are the exact queries that appear in a fashion discovery
context. A shopper using vibe language to find style is the highest-intent shopper;
returning non-apparel kills the moment.

**Next step:** Implement Phase 1 as specified in `VIBE_AESTHETIC_SEARCH_PLAN.md §4`:
add a third intent branch to `search_products` that (a) detects aesthetic terms via
the Appendix A lexicon, (b) restricts the candidate set to
`taxonomy.category ∈ APPAREL_DEPARTMENT`, and (c) OR-expands the query with the
canonical expansion tokens. Ship behind a shadow variant, run
`npm run eval:search --variant=<shadow>` to gate, then promote. Estimated effort:
~half a day, $0 API cost.

---

## 2 · Kill the description enrichment backfill — it enriches a dropped column

**The gap:** `docs/BACKFILL_STATUS.md` shows a May 2026 enrichment run that hit
~5.7% of products and stalled. The plan was to enrich `products.description` with
lifestyle context (occasions, activities, price). But migration `20260603000002`
explicitly **removed `description` from the search document** ("`-- 2. Drop
description from the searchable doc. It carries legacy v1 …`"). The current
`search_products` builds its tsvector from `product_occasions_text()` — which
reads `styling_metadata.occasion`, `fit_intelligence`, and `product_taxonomy` —
and from the embedding; `description` does not appear. Any enrichment applied to
`description` has **zero effect on search results**.

The `VIBE_AESTHETIC_SEARCH_PLAN.md` makes the architecture explicit: the lever is
structured facets (`taxonomy.style`, department-aware routing), not a flat text
blob. Section 3 calls out the enrichment approach by name as the failure mode
("Honesty over volume. Do not stuff trend words … re-introduces the term-dilution
that got `description` dropped").

**Why it matters:** The stale status doc is a trap for the next session or developer
picking this up — it reads as "worth resuming" when the approach was superseded.
The `description_enriched` flag and the `scripts/enrich-all-descriptions.mjs`
script are the active artefacts.

**Next step:** Add a header to `docs/BACKFILL_STATUS.md` marking it "SUPERSEDED —
description is no longer in the search doc; see VIBE_AESTHETIC_SEARCH_PLAN.md."
Then decide whether to (a) drop the `description_enriched` column and delete the
backfill scripts (clean, but needs a migration), or (b) leave the column in place
but document that it's display-only. Either way, do not continue the backfill.

---

## 3 · Looks have two parallel "seen" systems — consolidate or document the split

**The gap:** `ContinuousFeed.tsx` maintains two separate seen-tracking paths for
looks:

| Path | Source | Applied to | Behaviour |
|---|---|---|---|
| `seenLookIds` | `fetchSeenLookIds()` → raw `user_events` query | `filteredLooks` via `reorderBySeen()` | Puts seen looks at the bottom, shuffled |
| `seenKeys` | `getSeenKeys()` → `user_seen_keys()` RPC | `semanticallyOrderedLooks` via `partitionUnseen()` | Hides seen looks entirely (reset when < 12 unseen) |

Both fire separate Supabase round trips on mount. Both ultimately read the same
`user_events` impression rows. The behaviours differ: `reorderBySeen` appends
seen content (never hides it); `partitionUnseen` hides it until the reset
threshold kicks in. A look can pass through both paths in the same session.

`PENDING_QUEUE.md` notes a reported symptom of "same order every visit" and flags
"the seen-tracking isn't populating." With two systems that overlap in reading but
diverge in behaviour, debugging which path is stale becomes confusing — both must
be working for the intended UX, but the right behaviour (hide vs. reorder) has
never been explicitly decided for looks.

**Why it matters:** This is the most likely root cause of the "same order" report
being hard to reproduce and hard to fix. One system can be working while the other
isn't, masking the full fix.

**Next step:** In `ContinuousFeed.tsx`, add a comment block above the `seenLookIds`
fetch (line ~313) and the `seenKeys` fetch (line ~352) explicitly naming which
rendered output each one gates, and why different behaviours were chosen. If looks
should behave like products (hide-and-reset), drop `fetchSeenLookIds` /
`reorderBySeen` and extend `partitionUnseen` to cover looks fully. If the
reorder-not-hide behaviour is intentional for looks (content is scarcer, hiding
creates an empty state), document that explicitly and prevent the two paths from
being confused in future debugging.

---

## 4 · Feed type-clustering for the seen/shuffled product portion has no decision yet

**The gap:** `PENDING_QUEUE.md §Feed ordering algorithm` specifies that once a
shopper has seen items, the seen portion should be "clustered by type — all shoes
together, then all shirts, etc. Grouped random, NOT pure random." The current
`reorderBySeen` (for looks) and `partitionUnseen` (for products) both apply no
type clustering — seen products are hidden entirely, and seen looks are shuffled
randomly. The queue notes: "Does NOT cluster the shuffled portion by product type
(item 4 — TODO)" and closes with "STILL NEEDS A DECISION: feed type-clustering
(product grid?)."

The scope question is also unresolved: `reorderBySeen` operates on looks, not
products, so applying type-clustering there would cluster by the look's primary
product type. For products, `partitionUnseen` (in `feed-compose.ts` / `seen-feed.ts`)
hides rather than shuffles, so there's no shuffled set to cluster. Meaning the spec
as written doesn't apply directly to the current implementation.

**Why it matters:** The shuffled-seen row in product grids is the "you've scrolled
past the fresh stuff" zone — a low-effort cluster-by-type there would make
re-discovery feel intentional rather than random, and it reduces the jarring
effect of surfacing unrelated adjacent tiles.

**Next step:** Decide the target explicitly: is type-clustering for (a) the
shuffled `seen` look tail in `reorderBySeen`, (b) a future "already seen" product
section that shows seen products grouped rather than hiding them, or (c) both?
Write the decision into `PENDING_QUEUE.md` and either spec out the implementation
(extend `reorderBySeen` to group `seen` by `look.products[0]?.type`, or add a
`clusterBySeen` pass in `feed-compose.ts`) or explicitly remove the TODO if the
hide-and-reset behaviour is the correct choice.
