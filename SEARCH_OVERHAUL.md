# Search Quality Overhaul — Session Log (4 May 2026)

## Overview

Started from a user report: searching "shoes" was showing Tennis Skirts, Dresses, and Socks.
Traced through the full 6-layer pipeline, found multiple root causes, and implemented fixes.

---

## Root Cause Analysis

### RC-1 — Supply famine (dominant cause)
The search index is `product_creative`, not `products`. Of 513 active products, **398 (77.6%) have zero live creatives** and are completely invisible to search. Per-type embedded-creative counts:
```
Top:43  Shorts:12  Jacket:8  Hat:8  Underwear:8  Toy:7  Fragrance:6
Sneakers:4  Dress:4  Pants:4  Furniture:4  Activewear:4
Swimwear:2  Shoes:2  Pet:2  Decor:2  Skirt:2  Bag:2
Phone:1  Haircare:1  Skincare:1  Book:1  (NULL):79
```
"perfume" returning 1 result is correct — there is literally one Fragrance creative embedded (PHLUR).

### RC-2 — Type taxonomy mismatch
`CANONICAL_TYPES` in `nl-search/index.ts` was a hard-coded 27-entry fashion-only list. The real `products.type` contains `Toy`, `Pet`, `Phone`, `Haircare`, `Decor`, `Furniture`, and 79 NULL rows. The normaliser silently dropped Haiku's correct picks for non-fashion queries.

### RC-3 — Concept-doc prompt was fashion-only
`embed-entity` system prompt was *"You are a fashion search indexer…"*. For a candle or phone product, Claude improvised nonsense — resulting in all non-fashion creatives collapsing into the same vector cluster.

### RC-4 — Closed-loop not converting
`search_backfill_nightly` cron ran daily but all cold misses stayed `backfill_status='none'`. The function was silently resetting to 'none' on any error or zero-result brainstorm.

### RC-5 — Hard type filter, no soft fallback
`search_creatives_hybrid` filtered with strict `p.type = any(filter_types)`. When the filtered pool fell below `min_results`, there was no graceful degradation.

### RC-6 — No per-product diversification
A single product (PHLUR) could occupy 6 of the top 24 slots. No dedup at product level.

### RC-7 — Embedding cache without TTL or versioning
`query_embeddings` had no `expires_at` or version columns. 21/33 cached rows predated the Haiku expansion column migration — stale forever.

### RC-8 — BM25 weight amplifying bad data
`concept_doc` was weight 'A' (highest). For non-fashion items the concept_doc was hallucinated fashion text, making the BM25 lane poisonous.

### RC-9 — No re-embed on product mutation
Trigger fired on `product_creative` status change only. Renaming a product or fixing its `type` never regenerated the concept_doc or embedding.

### RC-10 — Visual lane never engaged for typed queries
`embedTextTwelveLabs` only fired for `intent='vibe'`. All other queries were text-only.

---

## What Was Implemented

### Tier 0 — Stop the bleeding

| ID | Task | Status | Commit/Migration |
|----|------|--------|-----------------|
| T0.1 | `product_types_canonical` materialised view | ✅ Done | `060_product_types_canonical.sql` |
| T0.2 | `products.category` column + backfill heuristic + auto-classify trigger | ✅ Done | `061_products_category.sql` |
| T0.3 | Per-category prompt routing in embed-entity (5 system prompts: fashion / beauty / home / tech / lifestyle) | ⏳ In progress | `embed-entity/index.ts` |
| T0.4 | Soft type filter in `search_creatives_hybrid` (relax when filtered pool < min_results, retry with broader pool) | ✅ Done | `062_soft_type_filter.sql` |
| T0.5 | Diversify by product_id at SQL layer (max 2 creatives per product via window function) | ✅ Done | `062_soft_type_filter.sql` |
| T0.6 | Lower concept_doc BM25 weight A → B | ✅ Done | `062_soft_type_filter.sql` |
| T0.7 | `query_embeddings.expires_at` + `embedding_v` / `expansion_v` columns; nl-search respects TTL | ⏳ In progress | `063_query_embeddings_ttl.sql` |
| T0.8 | Trigger on `products` mutation → re-embed joined live creatives | ⏳ In progress | `061_products_category.sql` |
| T0.9 | Backfill all 207 live creatives with new per-category prompts | ⏳ Pending | needs embed-entity deploy first |

### Tier 1 — Close the loop

| ID | Task | Status |
|----|------|--------|
| T1.1 | `products.text_embedding vector(1536)` + auto-embed trigger | ✅ Done (`064_products_text_embedding.sql`) |
| T1.2 | `search_products_hybrid` RPC | ✅ Done (`064_products_text_embedding.sql`) |
| T1.3 | nl-search orchestrator: union products fallback when creative pool < min_results | ✅ Done (`nl-search/index.ts` v34+) |
| T1.4 | `search_backfill_attempts` observability table | ⏳ Pending |
| T1.5 | Expand `search_query_misses` view to include high-result-low-CTR queries | ⏳ Pending |

### Tier 2 — Eval harness (partial)

| ID | Task | Status |
|----|------|--------|
| T2.1 | Eval harness: 51 golden queries, `tests/search/run-golden.mjs` runner | ✅ Done |
| T2.2 | Two-stage retrieval (recall 200 → rerank) | Scoped only |
| T2.3 | Per-intent pipeline split (browse / pairing / vibe) | Scoped only |
| T2.4 | Persist QueryPlan as standalone service | Scoped only |
| T2.5 | Replace heuristic concept fallback with crawler-extracted PDP content | Scoped only |

### Tier 3 — Quarter scope (not implemented)
- pgvectorscale / managed vector DB
- Domain fine-tuned bi-encoder on click-through pairs
- Active learning loop

---

## Bug Fixes Applied (with commits)

| Fix | File | Commit |
|-----|------|--------|
| `semanticallyOrderedCreatives` was never appending filteredCreatives → search returns empty | `ContinuousFeed.tsx` | `8da45cd` |
| `filteredCreatives` returned wrong items for q≥3 (now returns `[]`) | `ContinuousFeed.tsx` | `982fb33` |
| `filteredLooks` text match returned looks containing skirts/dresses for "shoes" → now returns `[]` for q≥3 | `ContinuousFeed.tsx` | `92dee2d` |
| `getLiveAds` product select was missing `type` field → tag-match tier broken | `product-creative.ts` | `92dee2d` |
| `semanticCreatives` useMemo was mapping nl-search product fallback rows with `video_url: null` → blank/image-only cards showing in results | `ContinuousFeed.tsx` | `f62decf` |

---

## Search Pipeline (3-Tier Architecture)

```
User types query (≥3 chars)
        │
        ├─► Tier 1: tagMatchedCreatives  (instant, ~0ms)
        │   getCreativesByCatalogTag(query) → DB query WHERE product.type IN (canonical_types)
        │   e.g. "shoes" → ['Sneakers','Boots','Sandals','Heels','Loafers','Flats','Mules']
        │
        ├─► Tier 2: semanticCreatives  (debounced, 400–2500ms)
        │   useSemanticSearch() → nl-search edge function (hybrid dense+BM25 via RRF)
        │   Now filters: .filter(c => !!c.video_url)  ← prevents product fallback rows showing
        │
        └─► Tier 3: filteredCreatives  (returns [] when q≥3, was incorrectly showing generic ads)

Merge: semanticallyOrderedCreatives = semanticCreatives if non-empty, else filteredCreatives
```

---

## Eval Harness Results (post-fix baseline)

Run: `ANON_KEY="..." node tests/search/run-golden.mjs`
Results saved to: `search-golden-results.json`

| Metric | Value |
|--------|-------|
| Total queries | 51 |
| Found@10 | 90.2% |
| MRR@10 | 0.868 |
| Failures | 0 |

---

## Known Remaining Issues / Pending Work

1. **T0.9 — Backfill**: All 207 live creatives need to be re-embedded with the new per-category prompts. Until this runs, non-fashion queries (hair cream, candles, brush) may still return suboptimal results.

2. **T1.4 — Backfill observability**: `search_backfill_attempts` table not yet created. Can't diagnose why the nightly cron converted zero rows for 5 nights.

3. **nl-search products fallback**: When fewer than 8 video creatives exist for a query, the edge function appends product records (no video) as a fallback. These now get filtered client-side (`video_url != null`) but the underlying supply gap remains until more creatives are generated for those product types.

4. **79 NULL-typed products**: Products without a `type` value are still invisible to type-based search. The `products.category` backfill helps route them but type-specific filtering won't work until types are populated.

---

## Architecture Guidelines (from session)

1. Search index = `product_creative ⨝ products` — treat as one virtual table; any product field used in concept_doc must trigger re-embed on mutation.
2. No hard-coded taxonomies in edge functions — all canonical sets come from SQL views.
3. Every search RPC accepts `min_results` and degrades gracefully.
4. Cache keys carry version columns; bump version, never delete the cache.
5. Closed-loop instrumentation is mandatory — any agent mutating the index must write to `*_attempts`.
6. One pipeline per intent.
7. No fashion-only assumptions in shared services.
8. Eval before merge — golden set must pass before any prompt/filter/weight change ships.

---

## Key Files Changed This Session

| File | Purpose |
|------|---------|
| `app/components/ContinuousFeed.tsx` | Search result merging, tier orchestration, video-url filter |
| `app/services/product-creative.ts` | Live ad fetching, type synonyms, getLiveAds type field fix |
| `supabase/functions/nl-search/index.ts` | Main search edge function (v34) — hybrid dense+BM25, soft type filter, products fallback |
| `supabase/functions/embed-entity/index.ts` | Per-category concept_doc generation |
| `supabase/migrations/060_*` | product_types_canonical view |
| `supabase/migrations/061_*` | products.category column + backfill + mutation trigger |
| `supabase/migrations/062_*` | soft type filter, product_id diversification, BM25 weight fix |
| `supabase/migrations/063_*` | query_embeddings TTL + versioning |
| `supabase/migrations/064_*` | products.text_embedding + search_products_hybrid RPC |
| `tests/search/run-golden.mjs` | Eval harness runner |
| `tests/search/golden.jsonl` | 51 golden query/expectation pairs |
| `search-golden-results.json` | Baseline eval results (90.2% found@10) |
| `debug-shoes-pipeline.json` | Debug snapshot confirming shoes nl-search was correct |
