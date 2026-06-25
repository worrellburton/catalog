# Catalog — Product Improvement Review
**Branch:** `main` · **Reviewed:** 2026-06-24T23:39Z · **Reviewer:** Claude Sonnet 4.6

Sources examined: `CLAUDE.md`, `docs/daily-feed.md`, `docs/PENDING_QUEUE.md`,
`docs/VIBE_AESTHETIC_SEARCH_PLAN.md`, `docs/SEARCH_ENRICHMENT_PLAN.md`,
`docs/ENRICHMENT_FINAL_RESULTS.md`, `docs/BACKFILL_STATUS.md`,
`supabase/functions/embed-product/index.ts` (buildDoc, SELECT column list),
`supabase/migrations/082_search_v3_clean.sql` (trg_products_auto_embed trigger column list),
`supabase/migrations/20260612010000_haiku_context.sql`,
`supabase/migrations/20260618000000_haiku_context_backfill_cron.sql`,
`supabase/migrations/20260601000001_user_seen_keys_rpc.sql`,
`supabase/migrations/20260605000006*.sql` (search_products V7),
`app/services/personalized-feed.ts`, `app/services/seen-feed.ts`,
`app/services/looks.ts` (fetchSeenLookIds, reorderBySeen),
`app/components/ContinuousFeed.tsx`, `app/components/FollowingRail.tsx`,
`app/components/CreativeCardV2.tsx`, `app/services/session-tracker.ts`,
`app/components/SessionTrackerHost.tsx`, and recent git log.

Items #1 and #2 carried forward from prior pass (2026-06-22) — still open.
Items #3 and #4 are new findings from this pass.

---

## 1 · `haiku_context` is generated for every product but never enters the search index

**The gap.** The `haiku-context` edge function writes a two-line visual description
to `products.haiku_context` (line 1: plain-language category, e.g. "potted plant";
line 2: colour + materials). A pg_cron backfill runs every 10 minutes for any
product with a primary image. The column is already consumed by `AIStylist.tsx`,
`type-governance.ts`, and `genders.ts` — but `embed-product/buildDoc()` does **not**
include it (confirmed: the SELECT at `supabase/functions/embed-product/index.ts:100`
lists `name, brand, type, description, size_fit, materials_care, fit_intelligence,
product_taxonomy, styling_metadata` — no `haiku_context`). Semantic search is blind
to the visual description.

The compounding problem: `trg_products_auto_embed` fires on
`AFTER INSERT OR UPDATE OF name, brand, type, description, is_active`
(`supabase/migrations/082_search_v3_clean.sql:321`) — `haiku_context` is absent.
When the cron sets `haiku_context` on a product that already has an embedding, the
auto-embed trigger never fires. The search vector predates the visual description
and is never refreshed.

**Why it matters.** The design intent for `haiku_context` was to correct misleading
scraped product names and provide a clean visual label (e.g. "oversized canvas tote"
vs. the raw product title). That signal improves taxonomy and gender inference — but
the embedding, which drives semantic search, was frozen before the visual description
existed. Shoppers searching "oversized canvas", "ankle strap heel", or "waffle knit"
get rankings that ignore the clearest per-product visual evidence for those terms.

**Next step.** In `supabase/functions/embed-product/index.ts`: add `haiku_context`
to the `SELECT` clause and insert it into `buildDoc`'s `parts` array (after
`materials_care`, before the JSON-enriched fields). In a new migration: add
`haiku_context` to the `trg_products_auto_embed` trigger column list and set
`force: true` in `notify_embed_product()` when
`NEW.haiku_context IS DISTINCT FROM OLD.haiku_context`. Then run a one-shot batch
re-embed for `WHERE haiku_context IS NOT NULL AND embedded_at < haiku_context_at`.

---

## 2 · Three separate `user_events` round trips fire on every feed mount — and the product-side RPC is unbounded

**The gap.** On every cold mount the consumer home page fires three independent
Supabase queries for seen-state:

| Component | Call | What it queries |
|---|---|---|
| `ContinuousFeed.tsx:354` | `fetchSeenLookIds(user.id)` | `user_events` direct — look UUIDs → `reorderBySeen` |
| `ContinuousFeed.tsx:392` | `getSeenKeys()` | `user_seen_keys()` RPC — look + product keys → `partitionUnseen` |
| `FollowingRail.tsx:115` | `fetchSeenLookIds(user.id)` | same `user_events` query again — unseen badge counts |

`fetchSeenLookIds` has no caching and is called independently by both `ContinuousFeed`
and `FollowingRail`, so the 50k-row look-impression query runs **twice in parallel**.
Meanwhile the product-side `user_seen_keys()` RPC
(`supabase/migrations/20260601000001_user_seen_keys_rpc.sql`) does
`SELECT DISTINCT … FROM user_events WHERE user_id = auth.uid()` with **no `LIMIT`**.
`fetchSeenLookIds` explicitly caps at 50,000 rows with a comment explaining the LRU
bias — the product-side RPC has no such cap and will do a full table scan as
impression history grows.

**Why it matters.** The three round trips are serial dead weight on page load for
any signed-in shopper. At 500 DAU × 200 impressions/session × 90 days, the
unbounded RPC becomes a visible p99 spike. The redundant `fetchSeenLookIds` pair
also means both callers race to build their own seen-set from potentially
in-flight data, making the "same order every visit" symptom (`PENDING_QUEUE.md`)
harder to isolate.

**Next step.** (a) Add a session-level cache to `fetchSeenLookIds`
(`app/services/looks.ts`) — same `Promise | null` module-level pattern as
`looksPromise`. Both `ContinuousFeed` and `FollowingRail` share the in-flight
result. Clear on auth change or `invalidateLooksCache()`. (b) Rewrite
`user_seen_keys` with a `WITH recent AS (… ORDER BY created_at DESC LIMIT 50000)`
inner query to bound the scan, mirroring the cap already in `fetchSeenLookIds`.

---

## 3 · Aesthetic/vibe search routing is fully designed but unimplemented

**The gap.** Consumer search now routes correctly on category intent ("white shoes"
→ footwear filter) and handles occasion vibes ("date night", "gym workout" — fixed
by the enrichment pass, 83% contextual success). But _aesthetic/trend_ queries
remain badly broken: `"quiet luxury"` returns Le Labo candles and Augustinus Bader
face cream; `"old money"` returns _The Psychology of Money_. The cause is diagnosed
and data-verified in `docs/VIBE_AESTHETIC_SEARCH_PLAN.md`: `taxonomy.style =
"minimal luxury"` was applied to all premium items across every department, so
expanding "quiet luxury" to "minimal luxury" surfaces candles and a laptop rather
than cashmere blazers. The `search_products` function has no department gate for
aesthetic queries.

**Why it matters.** Aesthetic queries — "quiet luxury", "clean girl", "streetwear"
— are the highest-intent fashion vocabulary a shopper can use. Getting them badly
wrong (a finance book for "old money") is the fastest way to lose trust in the
search bar entirely. This failure mode is user-visible on any fashion-forward entry
into the product.

**What's ready.** `docs/VIBE_AESTHETIC_SEARCH_PLAN.md` Phase 1 is fully scoped:
add a third route to `search_products` that fires before the vibe fallback when an
aesthetic term is detected via a curated regex (Appendix A), hard-filters candidates
to `taxonomy.category IN APPAREL_DEPARTMENT`, and OR-expands the query with
canonical apparel tokens ("quiet luxury" also matches `minimal, tailored, refined,
cashmere`). Estimated: ~½ day, $0, low risk. Same shadow→eval→promote gate as V7.

**Next step.** Implement Phase 1 from the plan doc: add the `aesthetic_intent()`
detection branch and `APPAREL_DEPARTMENT` filter as a new `ELSIF` block in the
`search_products` plpgsql function (new migration following `20260605000006*.sql`
pattern). Add eval assertions from Appendix A's lexicon to
`tests/search/eval-relevance.mjs` before promoting to canonical. Phase 2 (curating
`taxonomy.style` to a controlled vocab, ~1 day + ~$0.10) is the next natural step
after Phase 1 passes eval.

---

## 4 · 324 products have no description text and are invisible to contextual search

**The gap.** The enrichment backfill (`scripts/enrich-all-descriptions.mjs`) skipped
324 of 793 products because `description IS NULL OR description = ''`. These products
can match exact-name and type queries via BM25, but have zero occasion, activity, or
style text in their embedding. They are effectively invisible to any contextual or
aesthetic query ("casual friday", "brunch", "date night"). `description_enriched`
correctly flags them as `false`, but no follow-up pass was ever written for the
no-description case — the current script just increments `skipped` and continues.

**Why it matters.** 324 ÷ 793 ≈ 41% of the catalog missed the enrichment lift
entirely. If any of those are the types already sparse in the active catalog (the
`SEARCH_QUALITY_ANALYSIS.md` noted jackets, sneakers, and accessories were thin),
the search gaps compound: no enrichment AND low catalog depth. Products that have
only a name and a brand are ranked purely by embedding similarity on the raw name
text — the weakest possible semantic signal.

**Next step.** Add an `elif not product.description` branch to
`scripts/enrich-all-descriptions.mjs` (~line 204): when `description` is empty,
call Claude Haiku with a _generation_ prompt (not the augmentation prompt used for
existing descriptions) to produce a 2–3 sentence synthetic description from
`name + brand + type + price + gender`. Example output: _"Casual shorts by Alo Yoga
at $78. Great for gym workouts, yoga sessions, and outdoor activities. Priced under
$100, ideal for everyday active wear."_ Cost: <$0.50 for 324 products at Haiku
rates. Re-embed with the existing `scripts/reembed-enriched-products.mjs`.

---

_Checked against `docs/PENDING_QUEUE.md`, `CLAUDE.md`, and the recent git log
(`3131c45`). Items D-rest, E, F, G–K (generate flow), L–T (large rebuilds), the
feed type-clustering decision, and the `daily-feed.md` doc-staleness note are
tracked elsewhere and not repeated here._
