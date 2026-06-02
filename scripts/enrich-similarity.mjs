#!/usr/bin/env node
/**
 * Similarity enrichment: writes a clean, attribute-only `similarity_profile`
 * and a controlled `product_taxonomy.category` per product, then embeds the
 * profile into `similarity_embedding` (via embed-product target=similarity).
 *
 * This powers the product-page "Similar" rail. It is SEPARATE from the
 * marketing description / products.embedding that feed search uses — those
 * are left untouched.
 *
 * Why: the enriched marketing description (occasion fluff, "dishwasher safe",
 * care text) makes unrelated items look alike (a coffee glass ranked Tide
 * pods). The profile strips all of that down to what the product *is*.
 *
 * Cost: ~$0.001/product on Claude Haiku (~$1 for the whole catalogue).
 *
 * Usage:
 *   set -a && source .env && set +a && node scripts/enrich-similarity.mjs
 *   ... --limit 12            # only the first N needing enrichment (sample)
 *   ... --ids id1,id2,id3     # only these product ids (targeted sample)
 *   ... --force               # redo even if similarity_profile already set
 *   ... --no-embed            # write profiles only, skip the embedding call
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://vtarjrnqvcqbhoclvcur.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) { console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
if (!ANTHROPIC_API_KEY) { console.error('❌ Missing ANTHROPIC_API_KEY'); process.exit(1); }

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const NO_EMBED = args.includes('--no-embed');
const limitArg = args.find(a => a.startsWith('--limit'));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1] || args[args.indexOf(limitArg) + 1], 10) : null;
const idsArg = args.find(a => a.startsWith('--ids'));
const IDS = idsArg ? (idsArg.split('=')[1] || args[args.indexOf(idsArg) + 1] || '').split(',').map(s => s.trim()).filter(Boolean) : null;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const BATCH_SIZE = 10;
const DELAY_BETWEEN_BATCHES = 1500;
const DELAY_BETWEEN_CALLS = 250;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Controlled category vocabulary. The category is the HARD GATE for "Similar",
// so it must be consistent — this list also de-fragments the legacy `type`
// (Shoes/Sneakers/Sandals/Boots → footwear, Top/T-Shirt → tops, etc.).
const CATEGORIES = [
  'tops', 'knitwear', 'bottoms', 'dresses', 'outerwear', 'footwear',
  'activewear', 'swimwear', 'underwear', 'sleepwear', 'accessories',
  'headwear', 'eyewear', 'bags', 'jewelry', 'watches', 'belts',
  'grooming', 'beauty', 'fragrance', 'drinkware', 'kitchenware',
  'home-decor', 'household', 'bedding', 'books', 'food-drink', 'tech',
  'fitness', 'pet', 'toys', 'other',
];

function buildPrompt(p) {
  return `You classify catalogue products for a "find similar items" feature. Extract ONLY what the product fundamentally IS — ignore marketing copy, occasions, care instructions, and price.

Product name: ${p.name}
Brand: ${p.brand || 'Unknown'}
Existing type: ${p.type || 'Unknown'}
Description (may contain marketing fluff — extract facts only):
${(p.description || 'none').slice(0, 600)}

Return ONLY a JSON object (no prose, no markdown fences):
{
  "category": one of [${CATEGORIES.join(', ')}] — the single best fit; use "other" only if truly none apply,
  "subcategory": 1-3 words for the specific item (e.g. "crew sweater", "coffee glass", "hair clay", "wide-leg jeans"),
  "material": main material(s) in 1-3 words, or "" if unknown,
  "color": primary colour in 1-2 words, or "" if unknown,
  "similarity_profile": one short line, lowercase, of the discriminative attributes only, in the form "category · subcategory · material · color · form/notes". NO marketing, NO occasions, NO care text, NO price. Keep under 160 chars.
}`;
}

async function classify(product) {
  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{ role: 'user', content: buildPrompt(product) }],
  });
  let text = (res.content[0]?.text || '').trim();
  // Strip accidental code fences.
  text = text.replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
  const obj = JSON.parse(text);
  let category = String(obj.category || '').toLowerCase().trim();
  if (!CATEGORIES.includes(category)) category = 'other';
  return {
    category,
    subcategory: String(obj.subcategory || '').trim(),
    material: String(obj.material || '').trim(),
    color: String(obj.color || '').trim(),
    similarity_profile: String(obj.similarity_profile || '').trim().slice(0, 200),
  };
}

async function embedSimilarity(productId) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/embed-product`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({ id: productId, target: 'similarity', force: true }),
  });
  if (!res.ok) { console.error(`   ⚠️  embed failed: ${(await res.text()).slice(0, 120)}`); return false; }
  return true;
}

async function getProducts() {
  let q = supabase
    .from('products')
    .select('id, name, brand, type, description, product_taxonomy, similarity_profile')
    .not('name', 'is', null);
  if (IDS && IDS.length) q = q.in('id', IDS);
  const { data, error } = await q;
  if (error) { console.error('❌ fetch failed:', error.message); process.exit(1); }
  let rows = data || [];
  if (!FORCE && !IDS) rows = rows.filter(p => !p.similarity_profile);
  if (LIMIT) rows = rows.slice(0, LIMIT);
  return rows;
}

async function main() {
  const products = await getProducts();
  console.log(`\n🔎 Similarity enrichment: ${products.length} products`);
  console.log(`   force=${FORCE} embed=${!NO_EMBED} limit=${LIMIT ?? 'none'} ids=${IDS ? IDS.length : 'none'}\n`);
  let ok = 0, fail = 0;

  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);
    console.log(`📦 Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(products.length / BATCH_SIZE)}`);
    for (const p of batch) {
      try {
        const c = await classify(p);
        const taxonomy = { ...(p.product_taxonomy || {}), category: c.category, subcategory: c.subcategory, material: c.material, color: c.color };
        const { error } = await supabase
          .from('products')
          .update({ product_taxonomy: taxonomy, similarity_profile: c.similarity_profile })
          .eq('id', p.id);
        if (error) { console.error(`   ❌ ${p.name}: ${error.message}`); fail++; continue; }
        if (!NO_EMBED) await embedSimilarity(p.id);
        ok++;
        console.log(`   ✅ ${p.name?.slice(0, 42)} → ${c.category} / ${c.subcategory}`);
      } catch (err) {
        fail++;
        console.error(`   ❌ ${p.name?.slice(0, 42)}: ${err.message}`);
      }
      await sleep(DELAY_BETWEEN_CALLS);
    }
    if (i + BATCH_SIZE < products.length) await sleep(DELAY_BETWEEN_BATCHES);
  }

  console.log(`\n✨ Done. ok=${ok} fail=${fail}`);
}

main().catch(e => { console.error(e); process.exit(1); });
