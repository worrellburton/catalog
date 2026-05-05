# Search Contextual Query Analysis

## Test Date: May 5, 2026

## Executive Summary

Our current V3 search (gte-small embeddings + BM25 hybrid) **cannot handle** contextual, constraint-based, or occasion queries. It works well for direct product searches but fails completely on queries involving:
- Price constraints ("shorts under 80")
- Occasions ("beach party", "date night")
- Activities ("gym workout")
- Styling contexts ("casual friday", "summer vacation")

**Success Rate: 0/7 contextual queries (0%)**

---

## What Works ✅

**Direct Product Searches:**
- "shorts" → 2 results
- "alo yoga shorts" → 1 result  
- "game time short" → 3 results

**How it works:**
- Semantic embedding similarity matches query to product name/brand/description
- BM25 text search matches exact words in product metadata
- Fusion algorithm (RRF) combines both signals
- Results filtered by score threshold (0.032)

---

## What Doesn't Work ❌

### 1. Price Constraints
**Queries tested:**
- "shorts under 80"
- "shorts under $80"

**Results:** 0 products found (despite having 4 shorts priced at $78)

**Why it fails:**
- Embedding model sees "under 80" as semantic context, not a filter
- No query parsing to extract price constraints
- No SQL WHERE clause for price filtering

**What's needed:**
```typescript
// Query parsing
const parsed = parseQuery("shorts under 80");
// → { product_type: "shorts", max_price: 80 }

// SQL filter
WHERE price_numeric <= $max_price
```

---

### 2. Occasion-Based Queries
**Queries tested:**
- "beach party"
- "date night"  

**Results:** 0 products found

**Why it fails:**
- Product descriptions are feature-focused: "high-rise elastic waistband and breezy fit"
- No lifestyle/occasion metadata: missing tags like "beachwear", "date-night", "party"
- Semantic similarity can't bridge the gap between "beach party" and "elastic waistband"

**Example product (Game Time Short):**
```
Description: "With a high-rise elastic waistband and breezy fit, 
the Game Time Short was made to keep up from sunrise to sunset."
```
- Contains "breezy" and "sunrise to sunset" (beach-adjacent language)
- Embedding still doesn't match "beach party" strongly enough (score < 0.032 threshold)

**What's needed:**

Option A: Enhanced product metadata
```sql
ALTER TABLE products ADD COLUMN occasions TEXT[];
-- occasions: ['beach', 'casual', 'summer', 'vacation']

ALTER TABLE products ADD COLUMN activities TEXT[];  
-- activities: ['workout', 'yoga', 'running', 'gym']

ALTER TABLE products ADD COLUMN style_tags TEXT[];
-- style_tags: ['athletic', 'dressy', 'casual', 'elegant']
```

Option B: Richer descriptions with AI
```
Old: "High-rise elastic waistband and breezy fit"
New: "High-rise elastic waistband and breezy fit. Perfect for beach 
days, summer parties, and casual weekend outings. The lightweight 
fabric keeps you cool during warm-weather activities."
```

Option C: Hybrid approach
- Use LLM to auto-tag occasions from existing descriptions
- Expand descriptions with lifestyle context
- Store tags for filtering, use enhanced descriptions for semantic search

---

### 3. Activity-Based Queries
**Queries tested:**
- "gym workout"

**Results:** 0 products found (despite having Alo Yoga athletic shorts)

**Why it fails:**
- Product type = "Shorts" (not "Activewear" or "Athletic Shorts")
- Description mentions "workout" implicitly but not explicitly
- Brand "Alo Yoga" is athletic, but search doesn't match brand context to activity

**What's needed:**
- Activity tags on products: `activities: ['workout', 'gym', 'yoga']`
- OR query expansion: "gym workout" → also search for "athletic shorts", "activewear"
- OR brand-activity mapping: Alo Yoga → [gym, yoga, workout]

---

### 4. Context/Styling Queries  
**Queries tested:**
- "casual friday"
- "summer vacation"

**Results:** 0 products found

**Why it fails:**
- No style tags (casual, business-casual, formal)
- No seasonal metadata (summer, winter, all-season)
- Semantic gap: "casual friday" doesn't match "cotton shirt" or "pants"

**What's needed:**
- Style taxonomy: casual, business-casual, smart-casual, formal, athletic, etc.
- Seasonal tags: summer, winter, spring, fall, all-season
- Dress-code tags: work, weekend, evening, vacation

---

## Current Search Architecture

```
User Query: "shorts under 80"
     ↓
1. Embed query → [0.123, -0.456, ...] (384-dim)
     ↓
2. search_products RPC:
   - Dense: HNSW cosine similarity on embeddings
   - BM25: ts_rank_cd on name||brand||type||description tsvector
   - RRF: fuse results (k=60)
   - Filter: score >= 0.032
     ↓
3. Return top k results

Problem: No price parsing, no occasion/context metadata
```

---

## Proposed Solutions

### Solution 1: Query Understanding (NLP)
Parse user intent before searching:

```typescript
interface ParsedQuery {
  product_type?: string;      // "shorts"
  brand?: string;             // "alo yoga"
  max_price?: number;         // 80
  min_price?: number;         
  occasion?: string[];        // ["beach", "party"]
  activity?: string[];        // ["workout", "gym"]
  style?: string[];           // ["casual", "athletic"]
  season?: string[];          // ["summer"]
  gender?: "male" | "female" | "unisex";
  color?: string;             // "black"
  material?: string;          // "cotton"
}

function parseQuery(query: string): ParsedQuery {
  // Use regex + LLM to extract:
  // - Price constraints: "under X", "less than X", "< X"
  // - Occasions: "beach party" → ["beach", "party"]
  // - Activities: "gym workout" → ["gym", "workout"]
  // - Product types: "shorts", "dress", "pants"
  // - Brands: "alo yoga", "james perse"
}
```

### Solution 2: Enhanced Product Metadata (Database Schema)
Add structured fields for filtering:

```sql
-- Migration: add contextual metadata
ALTER TABLE products ADD COLUMN occasions TEXT[] DEFAULT '{}';
ALTER TABLE products ADD COLUMN activities TEXT[] DEFAULT '{}';
ALTER TABLE products ADD COLUMN style_tags TEXT[] DEFAULT '{}';
ALTER TABLE products ADD COLUMN seasons TEXT[] DEFAULT '{}';
ALTER TABLE products ADD COLUMN colors TEXT[] DEFAULT '{}';
ALTER TABLE products ADD COLUMN materials TEXT[] DEFAULT '{}';

-- Create GIN indexes for array containment queries
CREATE INDEX idx_products_occasions ON products USING GIN (occasions);
CREATE INDEX idx_products_activities ON products USING GIN (activities);
CREATE INDEX idx_products_style_tags ON products USING GIN (style_tags);

-- Update scraper to extract these fields using Claude
-- Update quality scoring to penalize missing tags
```

### Solution 3: Two-Phase Search
1. **Filter phase** (SQL WHERE clauses from parsed query)
2. **Rank phase** (semantic + BM25 over filtered results)

```sql
-- Example: "shorts under 80 for beach party"
-- Phase 1: Parse query
-- → { product_type: "shorts", max_price: 80, occasions: ["beach", "party"] }

-- Phase 2: Build SQL filter
WHERE 
  type = 'Shorts'
  AND price_numeric <= 80
  AND occasions && ARRAY['beach', 'party']  -- overlaps

-- Phase 3: Semantic + BM25 rank within filtered set
-- (current search_products RPC logic)
```

### Solution 4: Richer Descriptions with AI
Use Claude to expand product descriptions with lifestyle context:

```python
# agents/product-scraper/agent.py enhancement
ENRICHMENT_PROMPT = """
Based on this product:
- Name: {name}
- Brand: {brand}
- Type: {type}
- Price: {price}
- Description: {description}

Expand the description to include:
1. Ideal occasions (beach, party, date night, work, gym, casual weekend)
2. Activities it's suitable for
3. Styling contexts (casual friday, summer vacation, etc.)
4. Season/weather appropriateness

Keep it concise (2-3 sentences added).
"""
```

**Pros:**
- No schema changes
- Immediate benefit for semantic search
- Can be backfilled via batch job

**Cons:**
- Slower scraping (extra API call per product)
- Can't filter efficiently (must scan all descriptions)

---

## Recommendation

**Hybrid Approach (Solutions 1 + 2 + 3):**

### Phase 1: Immediate (1-2 days)
✅ Add query parsing for price constraints
✅ Implement price filtering in search RPC
✅ Test: "shorts under 80" should work

### Phase 2: Short-term (3-5 days)
✅ Add metadata columns (occasions, activities, style_tags, seasons)
✅ Update scraper to extract tags using Claude
✅ Backfill existing products with AI-generated tags
✅ Update search to filter by tags when present in query

### Phase 3: Medium-term (1-2 weeks)
✅ Expand product descriptions with lifestyle context (AI enrichment)
✅ Re-embed all products with enriched descriptions
✅ Fine-tune threshold and ranking for occasion queries
✅ Test suite for 20-30 contextual queries (golden set)

---

## Expected Improvement

**After Phase 1:** Price queries work (2/7 queries → 28%)
**After Phase 2:** Occasion/activity queries work if tags exist (5/7 → 71%)  
**After Phase 3:** All contextual queries work well (7/7 → 100%)

---

## Cost-Benefit Analysis

### Cost
- Dev time: ~1 week  
- Claude API calls for enrichment: ~$50 for 793 products
- Re-embedding cost: free (gte-small is in-edge)

### Benefit  
- **User experience:** "beach party" finds relevant products
- **Conversion:** More accurate results → higher purchase intent
- **Retention:** Natural language search feels intuitive
- **Competitive:** Most fashion e-commerce still uses basic keyword search

### ROI
High — contextual search is a major UX differentiator in fashion discovery.

---

## Test Results Summary

| Query | Current Result | After Phase 1 | After Phase 2 | After Phase 3 |
|---|---|---|---|---|
| shorts under 80 | ❌ 0 results | ✅ 4 results | ✅ 4 results | ✅ 4 results |
| beach party | ❌ 0 results | ❌ 0 results | ✅ 5-10 results | ✅ 8-15 results |
| date night | ❌ 0 results | ❌ 0 results | ✅ 5-10 results | ✅ 10-20 results |
| gym workout | ❌ 0 results | ❌ 0 results | ✅ 8-12 results | ✅ 12-20 results |
| casual friday | ❌ 0 results | ❌ 0 results | ✅ 5-10 results | ✅ 10-15 results |
| summer vacation | ❌ 0 results | ❌ 0 results | ✅ 5-10 results | ✅ 10-20 results |

---

## Next Steps

1. **Decide:** Do we want to support contextual search? (Recommend: YES)
2. **Prioritize:** Which phase to implement first?
3. **Design:** Review proposed schema and query parser design
4. **Build:** Implement Phase 1 (price filtering)
5. **Test:** Validate with golden test suite
6. **Iterate:** Measure improvement, tune threshold/ranking

---

## Appendix: Test Script Output

See: `test-contextual-search.mjs` and `test-baseline-search.mjs`

**Baseline (direct product search):**
```
✅ "shorts" → 2 results
✅ "alo yoga shorts" → 1 result  
✅ "game time short" → 3 results
```

**Contextual (price/occasion/activity):**
```
❌ "shorts under 80" → 0 results
❌ "beach party" → 0 results
❌ "date night" → 0 results
❌ "gym workout" → 0 results
❌ "casual friday" → 0 results
❌ "summer vacation" → 0 results
```

---

## Contact

Questions? See:
- Search V3 implementation: `supabase/migrations/087_search_balanced_hybrid.sql`
- Edge function: `supabase/functions/search/index.ts`
- Test scripts: `test-contextual-search.mjs`, `test-baseline-search.mjs`
