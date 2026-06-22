# Catalog Webapp — Product Improvement Review

**Date:** 2026-06-22  
**Branch:** `main` (read-only review)  
**Sources:** CLAUDE.md, docs/*, PENDING_QUEUE.md, VIBE_AESTHETIC_SEARCH_PLAN.md, daily-feed.md, ENRICHMENT_FINAL_RESULTS.md, recent git log, key component and service files

---

## Method

Context was built from all docs, the last 20 commits, the pending-work queue, and targeted reads of the components most relevant to each finding. Items already tracked in PENDING_QUEUE.md, VIBE_AESTHETIC_SEARCH_PLAN.md, or daily-feed.md's "open improvements" list were treated as known — only genuinely untracked gaps are listed here (exception: #3 and #4, which ARE listed in daily-feed.md as "open improvements" but appear in no plan or queue, and are high enough priority to escalate).

---

## Suggestions

---

### 1. Search CTR is hardcoded to zero — the admin's click-through metric is permanently broken

**The problem.** `logSearch()` in `app/services/search-log.ts` accepts a `clicked: boolean` field, and the admin `/admin/search` Overview tab calculates a "Click Through Rate" by counting rows where `clicked === true`. But the only call site — `app/components/ContinuousFeed.tsx:974` — always passes `clicked: false`. There is no code anywhere in the app that ever sets it to `true` (confirmed by grep). The CTR stat has been 0% since the metric was added; the team is making search-quality decisions without any knowledge of which queries lead to actual engagement.

**Why it matters.** Zero-result queries are easy to spot. Silent failures — queries that return results but no user opens anything — are invisible without CTR. The `clicked` infrastructure exists precisely to surface them, and the admin UI is already wired to display the number. This is the cheapest signal available to distinguish "search is working" from "search is returning irrelevant results users ignore."

**Concrete next step.** In `app/services/search-log.ts`, add a `markSearchClicked()` function that sets `clicked = true` on the most recent un-flushed entry in the queue for the current user (or sends a one-row patch if the entry already flushed). In `app/components/ContinuousFeed.tsx`, call `markSearchClicked()` when the user opens any look or product tile while `committedQuery` is non-empty. This is a ~1-hour change that immediately gives the admin search dashboard a meaningful CTR number.

---

### 2. Add a price range filter — the only documented hard failure mode in search still has no fix

**The problem.** `docs/ENRICHMENT_FINAL_RESULTS.md` explicitly flags "price comparisons ('shorts under $80') — requires UI numeric filtering, not text search" as the one remaining failure after enrichment. The Future Improvements section of the same doc lists "Add UI price range slider" as item #1. Six months later it is still unbuilt. The `Product` interface in `app/data/looks.ts` already carries a `price: number` field on every record; filtering is purely a UI gap, not a data gap.

**Why it matters.** Price is among the three most common facets in fashion commerce — "under $X" is a primary refinement after occasion. A shopper who types "white jeans under $150" today gets zero results and no guidance, which reads as search being broken rather than a missing feature. Every fashion competitor (SSENSE, Shopbop, Net-a-Porter) surfaces a price slider by default.

**Concrete next step.** Add `priceMax: number | null` to the active-filter state in `app/components/GridView.tsx` alongside the existing gender/type filters. Expose it as a max-price input or range chip in `app/components/BottomBar.tsx` (pattern mirrors the existing gender filter chip). In GridView's `useMemo` for `filteredLooks`, add `&& (!priceMax || product.price <= priceMax)` to the product filter pass. The whole change lives in two files, uses data already on the model, and closes the only confirmed search failure mode.

---

### 3. Extend Daily Feed personalization to looks, not just products

**The problem.** `docs/daily-feed.md` (the canonical reference) states: "The daily re-rank currently reorders **products only**; looks keep the unified `feed_rank`." Every shopper sees looks in essentially the same order — the global `feed_rank` with seen-decay — regardless of whether they engage with streetwear or resort looks, emerging creators or established brands. The personalization investment (edge function, Claude re-rank, `personalized_feeds` table, Feed Rules) currently only touches the product tiles inside looks; the look sequence itself is identical for all users.

**Why it matters.** Look order is the home feed's primary axis of differentiation. A shopper who consistently opens Kith looks and ignores coastal-resort content will keep seeing the same mix until the `feed_rank` decay slowly shifts things — there is no affinity-driven signal nudging their preferred content to the top. Extending the same behavioral signals (engaged creator handles, dominant look categories from `user_events`) to rank looks would make the home feel genuinely curated per-person, not just per-product.

**Concrete next step.** In `supabase/functions/personalize-feed/index.ts`, extract creator and category affinity from the same `user_events` signals already used for product ranking. Apply them as a soft re-rank weight on the look candidate pool, producing a ranked look ID array. Store it in a new `ranked_looks` column alongside `ranked_items` in the `personalized_feeds` table. Update `app/services/personalized-feed.ts` to return and apply this look order in the consumer feed, parallel to the existing product-order path. The behavioral signal infrastructure is already built; this reuses it on a new output.

---

### 4. Date-seed the Daily Feed head so it visibly changes every day for high-affinity users

**The problem.** `docs/daily-feed.md` notes: "for a shopper with very stable tastes the *head* of the order can repeat day-to-day (the strongest-affinity items lead every day) even though the tail rotates — so the change can be hard to see above the fold." The "Your next feed drops in HH:MM:SS" countdown creates an explicit user expectation that opening the app tomorrow will feel different. If the top 6–8 cards are the same strong-affinity items day after day, the daily freshness promise rings hollow — the countdown trains users to expect a change they don't experience.

**Why it matters.** Perceived freshness drives return visit rate. If the feed looks unchanged above the fold on day 2, users don't scroll to find the new content; they disengage. A date-seeded head rotation costs nothing in data quality — the same high-affinity items remain near the top, just in a different order — but makes the day-to-day change visible without modifying the personalization model.

**Concrete next step.** In `app/services/personalized-feed.ts`, after `getPersonalizedProductOrder()` returns the ranked array, apply a deterministic rotation to the top N items (e.g. top 12) using `today's feed date` as the seed — `index = (originalIndex + dayIndex) % N`. This keeps the same high-affinity items in the head but shifts their sequence daily. The rotation is pure client-side arithmetic on the cached result; no edge function changes required.

---

## What was checked and ruled out

- **Vibe/aesthetic search (Phases 1–3):** Fully specified in `docs/VIBE_AESTHETIC_SEARCH_PLAN.md`. Not listed here.
- **New-product enrichment pipeline:** `VIBE_AESTHETIC_SEARCH_PLAN.md §7` confirms `generate_taxonomy_and_styling` already runs on every scrape. Not a gap.
- **Pending queue items (A–T):** All tracked in `docs/PENDING_QUEUE.md`. Not listed here.
- **Seen-tracking / feed shuffle:** PENDING_QUEUE notes the `reorderBySeen` / seen-population issue; it's tracked there.
- **Comment deep-links:** Real gap, but the comments-as-bottom-drawer change (item E in PENDING_QUEUE) was recently shipped and changes the routing model — the right fix depends on the new architecture. Defer until the drawer is stable.
