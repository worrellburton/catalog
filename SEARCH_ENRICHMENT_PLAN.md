# Search Enhancement via Description Enrichment

## Goal
Enable contextual search queries (price, occasion, activity) by enriching product descriptions with AI-generated context, **without changing search architecture**.

## Current State ✅
- Search works great for direct product queries: "shorts", "alo yoga shorts", "game time short"
- Hybrid semantic (gte-small embedding) + BM25 text search
- Score threshold 0.032 filters unrelated results
- 91.7% success rate on active product catalog

## Problem ❌
- Contextual queries fail: "shorts under 80", "beach party", "gym workout"
- Product descriptions are feature-focused: "high-rise elastic waistband"
- Missing lifestyle/occasion/price context that users search for

## Solution: AI Description Enrichment

### Approach
**Enrich the `description` field** with context so semantic search can match naturally:

**Current description:**
```
"High-rise elastic waistband and breezy fit, made to keep up from sunrise to sunset."
```

**Enriched description:**
```
"High-rise elastic waistband and breezy fit, made to keep up from sunrise to sunset. 
Perfect for beach parties, summer vacations, casual weekends, and gym workouts. 
Priced at $78, under $100. Great for athletic activities, yoga sessions, and active lifestyles."
```

When user searches "beach party" or "shorts under 80", the semantic embedding will match these enriched phrases.

---

## Implementation Plan

### Step 1: Update Scraper (agents/product-scraper/agent.py)

Add enrichment to the save_product flow:

```python
def enrich_description(product: dict) -> str:
    """
    Use Claude to add lifestyle context to product description.
    
    Input: {name, brand, type, price, description, gender}
    Output: Original description + contextual phrases
    """
    base_description = product.get('description', '')
    
    enrichment_prompt = f"""
Given this product:
- Name: {product['title']}
- Brand: {product['brand']}
- Type: {product['type']}
- Gender: {product['gender']}
- Price: {product['price']}
- Current description: {base_description}

Add 2-3 SHORT sentences with:
1. Occasions it's perfect for (beach party, date night, casual friday, gym workout, etc.)
2. Activities it suits (running, yoga, lounging, travel, etc.)
3. Price context (under $X, affordable, luxury, etc.)
4. Style context (casual, athletic, dressy, business-casual, etc.)

Keep it natural and concise. Return ONLY the additional sentences, not the full description.
"""
    
    # Call Claude via Anthropic API
    response = anthropic_client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=200,
        messages=[{"role": "user", "content": enrichment_prompt}]
    )
    
    enrichment = response.content[0].text.strip()
    
    # Combine original + enrichment
    return f"{base_description} {enrichment}".strip()
```

**Update save_product tool call:**
```python
# In save_to_supabase or modal_app.py
enriched_description = enrich_description(product)

update_payload = {
    # ... existing fields
    "description": enriched_description,  # Save enriched version
}
```

---

### Step 2: Backfill Existing Products

Create migration to enrich all 793 products:

```sql
-- supabase/migrations/088_enrich_product_descriptions.sql

-- Add a flag to track enrichment status
ALTER TABLE products ADD COLUMN description_enriched BOOLEAN DEFAULT FALSE;

-- Function to call edge function for enrichment
CREATE OR REPLACE FUNCTION enrich_product_description(product_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  product_data RECORD;
  enriched_text TEXT;
BEGIN
  -- Get product data
  SELECT name, brand, type, gender, price, description
  INTO product_data
  FROM products
  WHERE id = product_id;
  
  -- Call edge function to enrich (or use pg_net to call external API)
  -- For now, mark as pending enrichment
  UPDATE products
  SET description_enriched = FALSE
  WHERE id = product_id;
END;
$$;

-- Mark all products as needing enrichment
UPDATE products SET description_enriched = FALSE;
```

**Backfill script:**
```javascript
// scripts/enrich-descriptions.mjs

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function enrichDescription(product) {
  const prompt = `
Given this product:
- Name: ${product.name}
- Brand: ${product.brand || 'Unknown'}
- Type: ${product.type || 'Unknown'}
- Gender: ${product.gender || 'unisex'}
- Price: ${product.price || 'N/A'}
- Current description: ${product.description || 'No description'}

Add 2-3 SHORT sentences with:
1. Occasions (beach party, date night, casual friday, gym workout)
2. Activities (running, yoga, lounging, travel)
3. Price context (under $X, affordable, luxury)
4. Style context (casual, athletic, dressy, business-casual)

Natural and concise. Return ONLY the additional sentences.
`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });

  const enrichment = response.content[0].text.trim();
  const originalDesc = product.description || '';
  
  return `${originalDesc} ${enrichment}`.trim();
}

async function backfillAll() {
  // Get all products that need enrichment
  const { data: products } = await supabase
    .from('products')
    .select('id, name, brand, type, gender, price, description')
    .eq('description_enriched', false)
    .limit(10); // Process in batches

  console.log(`Enriching ${products.length} products...`);

  for (const product of products) {
    try {
      const enriched = await enrichDescription(product);
      
      // Update product with enriched description
      await supabase
        .from('products')
        .update({ 
          description: enriched,
          description_enriched: true 
        })
        .eq('id', product.id);
      
      console.log(`✅ ${product.name}`);
      
      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 100));
      
    } catch (err) {
      console.error(`❌ ${product.name}:`, err.message);
    }
  }
}

backfillAll();
```

---

### Step 3: Re-embed Products

After enrichment, trigger re-embedding so semantic search picks up new context:

```bash
# Re-embed all products with enriched descriptions
node scripts/reembed.mjs --kind=products --force=true
```

The existing `embed-product` edge function will:
1. Read the enriched description
2. Generate new gte-small embedding (384-dim)
3. Update products.embedding column

---

### Step 4: Test Contextual Queries

Run tests again:

```bash
node test-contextual-search.mjs
```

**Expected improvements:**

| Query | Before | After Enrichment |
|---|---|---|
| shorts under 80 | ❌ 0 results | ✅ 4 results |
| beach party | ❌ 0 results | ✅ 5-10 results |
| gym workout | ❌ 0 results | ✅ 8-12 results |
| date night | ❌ 0 results | ✅ 5-10 results |
| casual friday | ❌ 0 results | ✅ 5-10 results |

---

## Why This Works

### Semantic Matching
The gte-small embedding will see:
- Query: "beach party" → embedding vector A
- Description: "...Perfect for beach parties, summer vacations..." → embedding vector B
- Cosine similarity between A and B will be HIGH (> 0.032 threshold)

### BM25 Text Matching
The tsvector search will match:
- Query: "shorts under 80"
- Description: "...Priced at $78, under $100..." 
- BM25 sees exact token matches: "under", "80" (or "100")

### Combined (RRF Fusion)
Both signals reinforce each other → top results

---

## Advantages vs Metadata Approach

| Aspect | Metadata Columns | Description Enrichment |
|---|---|---|
| Schema changes | ✅ Need new columns | ❌ None |
| Query parsing | ✅ Need parser | ❌ None |
| Search changes | ✅ Add filters | ❌ None |
| Indexing | ✅ GIN indexes | ❌ Uses existing |
| Deployment | ✅ Migration + code | ❌ Just enrichment |
| Complexity | High | Low |
| Maintenance | More code | Just descriptions |

---

## Cost Estimate

### Claude API for Enrichment
- 793 products × 200 tokens/product = ~159,000 tokens
- Input: 793 × ~300 tokens = ~238,000 tokens (reading product data)
- Total: ~397,000 tokens
- Cost at $3/M input, $15/M output: ~$1.19 + $2.39 = **~$3.58 total**

### Re-embedding Cost
- Free (gte-small is in-edge via Supabase.ai)

**Total cost: ~$4** for complete contextual search upgrade

---

## Timeline

| Task | Time |
|---|---|
| Update scraper enrichment | 2 hours |
| Create backfill script | 1 hour |
| Run backfill (793 products) | ~30 min (with delays) |
| Re-embed all products | ~10 min |
| Test & validate | 1 hour |
| **Total** | **~5 hours** |

---

## Risks & Mitigation

### Risk 1: Enrichment too generic
**Mitigation:** Test on 10 products first, tune prompt

### Risk 2: Token limit on long descriptions
**Mitigation:** Truncate base description to 500 chars before enrichment

### Risk 3: Claude API rate limits
**Mitigation:** Add delays (100ms between requests), process in batches

### Risk 4: Breaks existing search
**Mitigation:** Test on smoke tests first. Enrichment only ADDS context, doesn't remove original description, so worst case is no change.

---

## Rollback Plan

If enrichment breaks search quality:

```sql
-- Restore original descriptions from backup
UPDATE products
SET description = original_description
WHERE description_enriched = TRUE;

-- Re-embed with original descriptions
-- (trigger will auto-fire)
```

Keep original descriptions in a backup column before enrichment.

---

## Next Steps

1. **Test enrichment on 5 sample products** (manual Claude call)
2. **Validate semantic search improves** (run test-contextual-search.mjs)
3. **If successful, implement scraper enrichment**
4. **Run backfill on all 793 products**
5. **Re-embed all products**
6. **Measure improvement** (should go from 0% → 70%+ on contextual queries)

---

## Example Enrichments

### Product: Game Time Short - Black (Alo Yoga, $78)

**Original:**
```
High-rise elastic waistband shorts with breezy fit and built-in shorts for coverage. 
Features subtle Alo branding.
```

**Enriched:**
```
High-rise elastic waistband shorts with breezy fit and built-in shorts for coverage. 
Features subtle Alo branding. Perfect for beach parties, summer vacations, gym workouts, 
and casual weekends. Priced at $78, under $100. Ideal for athletic activities, yoga 
sessions, running, and active lifestyles.
```

**Now matches:**
- "beach party" ✅
- "gym workout" ✅
- "shorts under 80" ✅
- "summer vacation" ✅

---

## Success Metrics

| Metric | Before | Target After |
|---|---|---|
| Contextual query success | 0% | 70%+ |
| Direct product query success | 91.7% | 91.7% (unchanged) |
| Avg description length | ~150 chars | ~300 chars |
| Semantic match quality | Good | Better |
| Implementation time | — | 5 hours |
| Cost | — | $4 |

---

## Conclusion

**Description enrichment is the right approach:**
- Simple (no schema/search changes)
- Fast to implement (5 hours)
- Cheap ($4)
- Low risk (additive, not destructive)
- Works with existing search
- Immediate user benefit

Let's do Phase 1 enrichment FIRST, then decide if we need metadata columns later.
