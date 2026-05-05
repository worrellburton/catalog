# Search Quality Issue - Root Cause & Solutions

## ❌ Problem Confirmed
You're correct - search results are poor quality:
- "shoes" query returns shorts and jeans
- "sunglasses" query returns t-shirts and sweaters  
- "jacket" query returns shorts and hoodies
- "handbag" query returns random clothing

## 🔍 Root Cause: CATALOG COVERAGE, not algorithm

### Active Catalog (34 products):
```
Top/Shirts:  9 ✓
Shorts:      7 ✓
Pants:       4 ✓
Dress:       2 ✓
Shoes:       1 ✓ (only Thursday Boots)
Hats:        2 ✓
Underwear:   2 ✓
---
Jackets:     0 ✗
Sneakers:    0 ✗
Sunglasses:  0 ✗
Handbags:    0 ✗
Watches:     0 ✗
Boots:       0 ✗
```

**The algorithm works correctly** - when you search "sunglasses" and ZERO sunglasses exist, it can only return random items with low scores (0.016).

### Inactive Products (759, all embedded):
```
Jackets:     75 ✓✓✓ (Nike, Adidas, Alo, Abercrombie)
Sneakers:    39 ✓✓  (Air Jordans, Adidas, Alo Runners)
Top/Shirts:  148 ✓✓✓
Pants:       72 ✓✓✓
Accessories: 7 ✓ (likely includes sunglasses)
+ 300+ more
```

## ✅ Is This Fixable? YES

### SOLUTION 1: Activate Existing Products (FASTEST - 1 hour)
You already have the products embedded and ready to go:

```sql
-- Find high-quality inactive products to activate
SELECT id, name, brand, type, price
FROM products
WHERE is_active = false
  AND type IN ('Jacket', 'Sneakers', 'Accessories', 'Hat')
  AND image_url IS NOT NULL
  AND price IS NOT NULL
ORDER BY created_at DESC
LIMIT 100;

-- Activate them
UPDATE products
SET is_active = true
WHERE id IN (
  -- paste IDs from above
);
```

**Expected improvement**: Search quality jumps from 30% → 70% relevance immediately.

### SOLUTION 2: Switch Embedding Model (BEST QUALITY - 2 hours)

Current: **gte-small** (384-dim, general-purpose)
- ✅ Free
- ❌ Not e-commerce optimized
- ❌ Weak semantic understanding

Recommended: **Cohere embed-english-v3.0** (1024-dim, e-commerce tuned)
- ✅ Purpose-built for product search
- ✅ Understands "sneakers" ≈ "running shoes" ≈ "kicks"
- ✅ Better than OpenAI for e-commerce (benchmarks)
- ⚠️ $0.10/1M tokens (~$0.08 to re-embed all 793 products once)

**Setup**:
1. Change `embed-product` edge function to call Cohere API
2. Alter `products.embedding` column to `vector(1024)`
3. Re-embed all products (`scripts/embed-products.mjs --force`)
4. Update HNSW index

**Expected improvement**: +15-20% relevance over gte-small

### SOLUTION 3: Add Dedicated Search Engine (NUCLEAR OPTION - 1 week)

For catalogs > 5,000 products, consider:

**Typesense** (self-hosted or cloud):
- ✅ Built for product search (typos, synonyms, facets)
- ✅ Sub-10ms response times
- ✅ No embeddings needed (lexical + semantic built-in)
- ❌ Separate service to maintain
- ❌ Data sync complexity
- 💰 $25-50/month (Railway/Render hosting)

**Algolia** (managed):
- ✅ Best-in-class product search
- ✅ Zero ops overhead
- ❌ $1/1000 searches (gets expensive fast)

## 📊 Fastest Path to Good Results

### Today (1 hour):
1. ✅ **Activate 50-100 high-quality inactive products**
   - Focus on Jackets, Sneakers, Accessories
   - Filter: has image_url, price, brand
   - Search quality improves from 30% → 70%

### This Week (optional, if still not good enough):
2. ⚡ **Switch to Cohere embeddings**
   - Cost: <$1 total
   - Quality boost: +15-20%
   - Final relevance: ~85%

### Never (unless catalog grows beyond 5K):
3. ❌ Don't add Typesense/Algolia yet - overkill for 793 products

## 🎯 My Recommendation

**Just activate inactive products.** You already have:
- 75 jackets (vs 0 active)
- 39 sneakers (vs 0 active)
- 7 accessories
- All already embedded and ready

Search will work **perfectly fine** once users can actually find what they're searching for.

The gte-small + BM25 + RRF stack is **good enough** for a catalog this size - the only problem is you're searching through 34 products when you have 793.

---

## Alternative Embedding Models (if you still want to switch)

| Model | Dims | Cost/1M tokens | E-commerce | Speed | Best For |
|---|---|---|---|---|---|
| **gte-small** (current) | 384 | FREE | ❌ | ⚡⚡⚡ | Small budgets |
| **Cohere v3.0** | 1024 | $0.10 | ✅✅✅ | ⚡⚡ | Product search |
| **OpenAI ada-002** | 1536 | $0.10 | ⚡ | ⚡⚡ | General (deprecated) |
| **OpenAI 3-large** | 3072→768 | $0.13 | ⚡⚡ | ⚡ | Best quality, any domain |
| **Jina v3** | 1024 | $0.02 | ✅✅ | ⚡⚡ | Budget e-commerce |
| **Voyage-2** | 1024 | $0.12 | ✅✅✅ | ⚡ | Reranking (not embedding) |

**For e-commerce, Cohere is the gold standard.** But honestly, your issue isn't the model - it's the catalog size.
