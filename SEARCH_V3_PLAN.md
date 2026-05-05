# Search V3 — Implementation Plan

> Status: **Planning**  
> Author: Engineering  
> Date: 5 May 2026  
> Local dev: uses `.env.local` (Supabase Docker at `127.0.0.1:54321`)

---

## Goal Checklist

| Goal | Covered? | How |
|---|---|---|
| Dynamic results for any term (black jeans combo, beach day, date night) | ✓ | Taxonomy fix unblocks pairing; facet_text backfill unblocks vibe/occasion; looks lane handles outfit queries |
| Results within 2 seconds | ✓ (added below) | `HAIKU_TIMEOUT_MS` 1800→900, looks RPC vibe-only, cache pre-warm |
| Accurate results, no unrelated junk | ✓ | BM25 gate already prevents drift; accuracy fails only because broken type filter bypasses it — taxonomy fix restores it |

---

## Problem Summary

Current search (`search_creatives_hybrid`) fails for "shoes", "caps", and most
non-top/shorts queries because:

1. **Type taxonomy mismatch** — static fallback maps `shoes → ['Sneakers','Boots',...]`
   but actual live DB type is `"Shoes"`. Zero rows match → soft-relaxes → unrelated junk.
2. **Supply famine** — search index is `product_creative`. 77%+ of active products have
   zero live creatives and are completely invisible.
3. **`facet_text` null** — 19 of 22 embedded creatives have `facet_text = NULL`.
   The weight-C BM25 shopper-language lane is dead.
4. **`min_results = 8` too high** — at current catalog size (≤9 creatives per type),
   every type-filtered query soft-relaxes immediately, padding with unrelated items.
5. **Haiku timeout → static fallback** — fallback uses the broken hard-coded synonym map.

---

## Architecture Decision

### Keep
- **OpenAI `text-embedding-3-small` (1536-dim)** — query + document embeddings. Same model
  both sides. No change.
- **TwelveLabs Marengo 3.0** — visual lane for vibe/pairing queries. No change.
- **RRF (Reciprocal Rank Fusion)** for merging dense + BM25 results. No change.
- **`search_creatives_hybrid`** — still used, just no longer the *only* path.

### Change
- **Primary search index: `products`** (not `product_creative`).
  Every active product is immediately searchable from day-one regardless of whether a
  creative has been generated yet.
- **Creative hydration step**: for each matched product, join best live creative
  (`status='live' AND enabled=true`, prefer `is_elite=true`, then by `rrf_score`).
  Rows with no creative return the product image card as fallback.
- **Type taxonomy → DB-driven + intent-only** (three-phase removal described below).

---

## Taxonomy: What Is Being Removed vs What Stays

> **Short answer**: We are removing type-filter-from-expansion, not the concept of types entirely.

The current system has three separate uses of "type":

| Use | Current state | V3 change |
|---|---|---|
| `filter_types` passed to SQL RPC from Haiku expansion | Broken — Haiku maps `shoes→['Sneakers']` but DB has `type='Shoes'` | **Removed from expansion path** (Phase C). Type is still in the BM25 index and scores naturally |
| Static fallback synonym map in `query-analyzer.ts` | Broken — same wrong strings | **Fixed** (Phase A), then **moved to DB** (Phase B) |
| UI filter chips → `filter_types` param | Works correctly, user-initiated | **Unchanged** — UI chips still pass explicit types to the RPC |
| `p.type` column in BM25 index (weight `A`) | Works — `type='Shoes'` gets BM25 credit for query "shoes" | **Unchanged** — this is what does the work in Phase C |

So after Phase C:
- Haiku no longer guesses `filter_types` — it focuses on keywords, occasions, seasons, colors, materials, styles
- The SQL RPC gets `filter_types: null` from expansion (dense + BM25 on all products)
- BM25 on `p.type` weight-A means a "shoes" query still ranks shoe products first naturally
- Only explicit UI facet chip selections send a real `filter_types` value

Phases A → B → C are sequential. Phase A alone fixes the immediate breakage.

---

## Three-Phase Taxonomy Removal

### Phase A — Quick fix (fixes "shoes" / "caps" immediately, ~2h)

Fix `query-analyzer.ts` synonym map to reflect **actual `products.type` values** in the DB.
The map was written against a planned taxonomy; the real DB uses different strings.

Key fixes needed:
```ts
// Current (WRONG — these types don't exist in active catalog):
shoes: ['Sneakers', 'Boots', 'Sandals', 'Heels', 'Loafers', 'Flats', 'Mules']

// Correct (matches actual DB):
shoes:     ['Shoes'],       // DB type is "Shoes" not "Sneakers"
shoe:      ['Shoes'],
sneakers:  ['Sneakers'],    // kept for when Sneakers products go active
cap:       ['Hat'],         // DB type is "Hat" not "Cap"
caps:      ['Hat'],
baseball_cap: ['Hat'],
```

Also: lower `min_results` from `8` → `3` in both `nl-search/index.ts` RPC calls so
soft-relaxation stops firing on every query.

### Phase B — DB-driven synonym map (removes hard-coded list, ~4h)

Replace `CATALOG_TYPE_SYNONYMS` in `query-analyzer.ts` with a runtime load from
`product_taxonomy` (migration 068, already exists in DB).

`product_taxonomy` schema:
```sql
type         text primary key   -- "Shoes", "Hat", "Top", ...
category     text               -- 'fashion' | 'beauty' | 'home' | 'tech' | 'lifestyle' | 'other'
synonyms     text[]             -- ['shoe','shoes','loafer','pump','heel','flat','mule']
keywords     text               -- BM25 expansion: 'shoe footwear leather sneaker trainer'
```

`nl-search` already calls `loadTaxonomyExamples()` which reads this table. Extend it to
also build the static fallback synonym map so both Haiku and the fallback share the same
DB-sourced truth.

Whenever a new product type enters the catalog (e.g. `Sneakers` goes active), ops adds one
row to `product_taxonomy` — no code deployment needed.

### Phase C — Intent-only, no type filter (long-term, next sprint)

Stop using `filter_types` as a SQL pre-filter entirely. Haiku classifies only:
- `intent`: `browse` | `pairing` | `vibe`
- `keywords`: stripped query + synonyms for BM25
- `occasions`, `seasons`, `colors`, `materials`, `styles`

Type filtering becomes **BM25-natural**: `p.type` is indexed at weight `A` in the RPC,
so a product with `type='Shoes'` gets full BM25 credit for the word "shoes" in its type
field without needing an explicit `filter_types=['Shoes']` parameter.

UI-level type filtering (filter chips) stays as a separate `filter_types` parameter
passed directly from the client, bypassing the expansion path entirely.

---

## Product-First Search Architecture

### Current flow (broken for sparse catalogs)
```
query → embed → search_creatives_hybrid(filter_types) → creative rows → client
                        ↑
              Only 33 embedded creatives. 77% of products invisible.
```

### V3 flow
```
query → embed → search_products_hybrid(filter_types=null) → product rows
                        ↓
              for each product: JOIN best live creative
                        ↓
              if no creative: return product image card (is_placeholder=true)
                        ↓
              client: show video if creative exists, image card if not
                        ↓
              [elite boost lane] search_creatives_hybrid(require_elite=true) → merge top
```

### New RPC: `search_products_with_creatives`

One SQL call that handles both the product search and creative hydration:

```sql
CREATE OR REPLACE FUNCTION public.search_products_with_creatives(
  query_embedding  vector(1536),
  query_text       text,
  k                int     DEFAULT 24,
  filter_gender    text    DEFAULT NULL,
  filter_types     text[]  DEFAULT NULL,   -- UI facet chips only, not from expansion
  require_elite    boolean DEFAULT FALSE,
  exclude_ids      uuid[]  DEFAULT '{}'::uuid[]
)
RETURNS TABLE(
  -- Product fields
  product_id        uuid,
  product_name      text,
  product_brand     text,
  product_price     text,
  product_type      text,
  product_gender    text,
  product_image_url text,
  product_url       text,
  -- Best creative fields (NULL if no live creative exists)
  creative_id       uuid,
  video_url         text,
  thumbnail_url     text,
  affiliate_url     text,
  duration_seconds  numeric,
  is_elite          boolean,
  is_placeholder    boolean,   -- true when no live creative → show image card
  -- Search metadata
  concept_doc       text,
  concept_facets    jsonb,
  facet_text        text,
  rrf_score         double precision,
  dense_rank        bigint,
  bm25_rank         bigint
)
```

Internal logic:
```sql
WITH
candidates AS (
  SELECT p.id, p.type, p.gender, ...
  FROM products p
  WHERE p.is_active = true
    AND (filter_gender IS NULL OR p.gender IS NULL OR p.gender = filter_gender OR p.gender = 'unisex')
    AND (filter_types IS NULL OR p.type = ANY(filter_types))
    AND (exclude_ids IS NULL OR p.id <> ALL(exclude_ids))
),
dense AS (
  -- ANN on products.text_embedding
  SELECT id, row_number() OVER (ORDER BY p.text_embedding <=> query_embedding) AS rk
  FROM candidates JOIN products p ON p.id = candidates.id
  WHERE p.text_embedding IS NOT NULL
  ORDER BY p.text_embedding <=> query_embedding
  LIMIT k * 6
),
bm25 AS (
  -- Weighted FTS: name(A) + brand(B) + type(B) + concept_doc(B) + facet_text(C) + description(C)
  SELECT id, row_number() OVER (...) AS rk
  FROM candidates JOIN products p ON p.id = candidates.id
  WHERE tsv @@ websearch_to_tsquery('english', query_text)
  LIMIT k * 6
),
fused AS (
  SELECT coalesce(d.id, b.id) AS id,
    (coalesce(1.0/(60+d.rk), 0.0) + coalesce(1.0/(60+b.rk), 0.0)) AS rrf_score,
    d.rk AS dense_rank, b.rk AS bm25_rank
  FROM dense d FULL OUTER JOIN bm25 b ON d.id = b.id
),
top_products AS (
  SELECT * FROM fused ORDER BY rrf_score DESC LIMIT k
),
best_creative AS (
  -- For each matched product: pick best live creative
  SELECT DISTINCT ON (pc.product_id)
    pc.product_id, pc.id AS creative_id,
    pc.video_url, pc.thumbnail_url, pc.affiliate_url,
    pc.duration_seconds, pc.is_elite
  FROM product_creative pc
  WHERE pc.product_id IN (SELECT id FROM top_products)
    AND pc.status = 'live' AND pc.enabled = true AND pc.video_url IS NOT NULL
  ORDER BY pc.product_id, pc.is_elite DESC, pc.impressions DESC
)
SELECT
  p.id AS product_id, p.name, p.brand, p.price, p.type, p.gender,
  p.image_url, p.url,
  bc.creative_id, bc.video_url, bc.thumbnail_url, bc.affiliate_url,
  bc.duration_seconds, bc.is_elite,
  (bc.creative_id IS NULL) AS is_placeholder,
  p.concept_doc, p.concept_facets, p.facet_text,
  tp.rrf_score, tp.dense_rank, tp.bm25_rank
FROM top_products tp
JOIN products p ON p.id = tp.id
LEFT JOIN best_creative bc ON bc.product_id = tp.id
ORDER BY tp.rrf_score DESC;
```

---

## Embedding Changes

### Products table (required for V3)
`products.text_embedding` column exists (migration 067). Needs to be populated.

**Run:**
```bash
set -a && source .env.local && set +a
SUPABASE_DB_URL="$SUPABASE_DB_URL" \
SUPABASE_FUNCTIONS_URL="$VITE_SUPABASE_URL/functions/v1" \
SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
node scripts/reembed.mjs --kind=products --concurrency=5
```

`embed-entity` with `entity_type='product'` already handles this. Writes:
- `concept_doc` — LLM factual description
- `concept_facets` — structured JSON
- `facet_text` — shopper phrases (fixes the null BM25 lane)
- `text_embedding` — OpenAI 1536-dim vector

### Creatives table (force re-embed to fix null `facet_text`)
19/22 live embedded creatives have `facet_text = NULL` because they were embedded before
migration 077 added the column.

**Run:**
```bash
set -a && source .env.local && set +a
SUPABASE_DB_URL="$SUPABASE_DB_URL" \
SUPABASE_FUNCTIONS_URL="$VITE_SUPABASE_URL/functions/v1" \
SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
node scripts/reembed.mjs --kind=creatives --force --concurrency=5
```

### No model change
Both products and creatives use the same model: OpenAI `text-embedding-3-small` (1536-dim).
Query embeddings in `nl-search` use the same model. No migration needed.

---

## Migration Plan

Next migration number: **080** (sequential after 079).

| # | Migration | Purpose |
|---|---|---|
| 080 | `080_search_v3_product_first.sql` | `search_products_with_creatives` RPC + lower BM25 weights |
| 081 | `081_taxonomy_seed.sql` | Populate `product_taxonomy.synonyms` + `keywords` for all active types |
| 082 | `082_search_v3_cleanup.sql` | Drop `search_products_hybrid` (replaced), update RLS if needed |

---

## Client Changes (`nl-search/index.ts`)

### Remove from expansion
```ts
// REMOVE: filter_types from expansion prompt and from RPC call
// KEEP:   intent, keywords, occasions, seasons, colors, materials, styles
```

### Replace main RPC call
```ts
// Replace:
admin.rpc('search_creatives_hybrid', { query_embedding, query_text, filter_types, ... })

// With:
admin.rpc('search_products_with_creatives', {
  query_embedding,
  query_text,       // bm25 text (OR-joined keywords)
  k,
  filter_gender,
  filter_types: null,   // no expansion-driven type filter; UI chips pass this directly
  require_elite: false,
  exclude_ids,
})
```

### Elite boost lane (keep `search_creatives_hybrid` for top slots)
```ts
// Still fire search_creatives_hybrid with require_elite=true, k=6
// RRF-merge those 6 elite creatives into top of results
// This preserves the "boosted" slot system for premium creatives
```

### Remove looks lane from default path
`search_looks_to_products` fires on every query adding ~100ms for zero benefit
(look-matched products have no creatives, filtered client-side). Move it to
vibe-intent only:
```ts
const looksRpc = expansion.intent === 'vibe'
  ? admin.rpc('search_looks_to_products', { ... })
  : Promise.resolve({ data: [] });
```

### Result shape stays identical
`search_products_with_creatives` returns the same column names that `CreativeCard` and
`ContinuousFeed` already use. `is_placeholder=true` rows can be rendered as image cards
immediately — no client-side shape change required beyond handling the new field.

---

## `query-analyzer.ts` Fix (Phase A)

Update `CATALOG_TYPE_SYNONYMS` to mirror actual `products.type` values:

```ts
// Fix incorrect mappings (type values that don't exist in DB):
shoes:     ['Shoes'],          // was ['Sneakers','Boots','Sandals','Heels','Loafers','Flats','Mules']
shoe:      ['Shoes'],
cap:       ['Hat'],            // was missing
caps:      ['Hat'],            // was missing

// Keep correct ones:
hat:       ['Hat'],
hats:      ['Hat'],
beanie:    ['Hat'],
sneakers:  ['Sneakers'],       // for future use when Sneakers products go active
```

Also update `OUTFIT_PAIRS` — the pairing map uses type strings as keys. Ensure
`'Shoes'` maps to complementary types (currently only `'Sneakers'`, `'Boots'`, etc. are keys):
```ts
Shoes: ['Pants', 'Shorts', 'Dress', 'Skirt', 'Bag'],
```

---

## `product_taxonomy` Seed (Phase B)

Populate synonyms and keywords for every active type in the DB. Ops task, no code change
needed after migration 081:

| type | synonyms | keywords |
|---|---|---|
| `Top` | shirt, tee, t-shirt, blouse, sweater, hoodie, knit, pullover | shirt top upper blouse |
| `Shoes` | shoe, shoes, heel, heels, loafer, flat, mule, pump | shoe footwear leather |
| `Hat` | hat, cap, caps, beanie, baseball cap, headwear, bucket hat | hat cap beanie headwear |
| `Pants` | pant, pants, jean, jeans, trouser, denim, legging, jogger | pants bottom trouser denim |
| `Shorts` | short, shorts | shorts |
| `Dress` | dress, gown, midi, maxi | dress gown |
| `Skirt` | skirt, midi skirt, maxi skirt | skirt |
| `Underwear` | bra, bras, underwear, lingerie | underwear bra lingerie |
| `Decor` | candle, candles, decor, houseplant, plant, diffuser, vase | candle decor plant home |
| `Other` | — | — |

`nl-search.loadTaxonomyExamples()` already reads this table and injects it as few-shot
examples into Haiku's prompt. Phase B adds: also build `CATALOG_TYPE_SYNONYMS` from this
table so the static fallback stays in sync.

---

## Latency: <2 Second Target

Current latency profile (cold cache miss):

```
Parallel:  OpenAI embed (~300ms)
           Haiku expansion (up to 1800ms)  ← bottleneck
           TwelveLabs Marengo (~200ms, vibe only)
Sequential: SQL RPC (~150ms after embed done)
Total cold: 1950–2400ms  → fails 2s target

Cache hit: ~80ms  → easily within target
```

### Fix 1 — Lower `HAIKU_TIMEOUT_MS`: 1800 → 900

Haiku typically responds in 800–1200ms. The 1800ms timeout was set because
600ms timed out too often. At 900ms we catch ~85% of Haiku responses and
fall through to the improved static fallback (Phase A fix) for the rest.

```ts
// nl-search/index.ts
const HAIKU_TIMEOUT_MS = 900;  // was 1800
```

New cold-miss latency: `max(900, OpenAI ~300) + SQL ~150 = ~1050ms`. Comfortably under 2s.

### Fix 2 — Move looks RPC out of blocking path

`search_looks_to_products` fires on every query in the current `Promise.all`,
adding ~100ms even when results are unused (browse/pairing queries). Scope it
to vibe-intent only (already in the `nl-search` changes section below):

```ts
// Only fire for vibe queries — saves 100ms on every browse/pairing query
const looksRpc = expansion.intent === 'vibe'
  ? admin.rpc('search_looks_to_products', { ... })
  : Promise.resolve({ data: [] });
```

### Fix 3 — Cache pre-warm after each deploy

Add a script that runs the top 50 golden queries against the live edge
function after each deploy so the cache is pre-populated before users hit it.

```bash
# scripts/prewarm-cache.mjs  (new file)
# Reads tests/search/golden.jsonl, calls nl-search for each query
# Run as: ANON_KEY=... node scripts/prewarm-cache.mjs
```

### Latency targets post-fix

| Path | Current | Target |
|---|---|---|
| Cache hit | ~80ms | ~80ms (unchanged) |
| Cache miss, Haiku responds fast | ~950ms | ~700ms |
| Cache miss, Haiku times out | ~2400ms | ~1050ms |
| Second+ request (same query) | ~80ms | ~80ms |

---

## min_results Fix

In `nl-search/index.ts`, lower `min_results` from `8` → `3`:

```ts
// Line ~890 in index.ts (search_creatives_hybrid call):
min_results: 3,   // was 8 — at current catalog size (≤9 per type) 8 always triggers relaxation

// Same for search_products_with_creatives:
min_results: 3,
```

---

## Local Dev Workflow

All development and testing uses the local Supabase stack from `.env.local`.

```bash
# 1. Load local env
source .env.local

# 2. Apply new migration locally
supabase db push --local

# 3. Deploy edge functions to local
supabase functions serve --env-file .env.local

# 4. Run embedding backfill against local
SUPABASE_DB_URL="$SUPABASE_DB_URL" \
SUPABASE_FUNCTIONS_URL="http://127.0.0.1:54321/functions/v1" \
SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
node scripts/reembed.mjs --kind=products --concurrency=3

# 5. Run golden eval against local
ANON_KEY="$VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY" \
SEARCH_URL="http://127.0.0.1:54321/functions/v1/nl-search" \
node tests/search/run-golden.mjs

# 6. Push to cloud only when golden pass rate ≥ baseline (90.2% found@10)
supabase db push
supabase functions deploy nl-search embed-entity
```

---

## Implementation Order

Each step is a self-contained deliverable. Steps 1–3 fix the immediate "shoes" / "caps"
failures. Steps 4–6 deliver the full product-first architecture.

| Step | Files | What it fixes | Est. |
|---|---|---|---|
| **1** | `query-analyzer.ts` | Phase A: synonym map fix, `min_results` 8→3 | 30m |
| **2** | `nl-search/index.ts` | Latency: `HAIKU_TIMEOUT_MS` 1800→900, looks RPC vibe-only | 15m |
| **3** | `scripts/reembed.mjs` run (`--kind=creatives --force`) | Populates null `facet_text` on 22 creatives | 10m |
| **4** | `product_taxonomy` seed SQL | Phase B foundation: synonyms for all active types | 30m |
| **5** | `scripts/prewarm-cache.mjs` (new) | Pre-warm top-50 queries after each deploy | 30m |
| **6** | Migration `080_search_v3_product_first.sql` | `search_products_with_creatives` RPC | 2h |
| **7** | `embed-entity` + `reembed.mjs` run (`--kind=products`) | Embeds all active products | 30m |
| **8** | `nl-search/index.ts` | Swap primary RPC, remove type filter from expansion | 2h |
| **9** | `ContinuousFeed.tsx` | Handle `is_placeholder` field, image card fallback | 1h |
| **10** | Phase C: remove `filter_types` from Haiku prompt | `nl-search/index.ts`, `query-analyzer.ts` | 1h |
| **11** | Golden eval + cloud deploy | Validate ≥ 90.2% found@10 before push | 30m |

---

## Success Metrics

| Metric | Current | Target post-V3 |
|---|---|---|
| found@10 (golden set) | 90.2% | ≥ 92% |
| MRR@10 | 0.868 | ≥ 0.88 |
| Cold-miss latency (p95) | ~2400ms | ≤ 1100ms |
| Cache-hit latency (p95) | ~80ms | ~80ms |
| "shoes" query → shoes result | ✗ | ✓ |
| "caps" / "hat" → Hat result | ✓ (2 creatives) | ✓ + image cards for unembedded |
| "black jeans combination" → tops/jackets | partial | ✓ (pairing fix) |
| "date night" / "beach day" → relevant | ✗ (facet_text null) | ✓ (after step 3) |
| Products searchable without creative | 0% | 100% |
| Queries returning `is_placeholder` cards | 0 | fills gaps, user sees full grid |
| `facet_text` null rate (live creatives) | 86% | 0% (after step 3) |

---

## What We Are NOT Changing

- Embedding model: stays `text-embedding-3-small` (1536-dim)
- Visual lane: TwelveLabs Marengo 3.0, vibe/pairing only
- RRF fusion weights: `1/(60+rank)` — unchanged
- `concept_doc` generation: Claude Haiku, per-category prompts — unchanged
- `search_creatives_hybrid` RPC: kept for elite boost lane
- `product_creative` table structure: no changes
- Client `CreativeCard` shape: no changes (same column names from new RPC)
