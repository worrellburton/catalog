#!/usr/bin/env node
/**
 * Enrichment v2 — occasion / use-case metadata for a GENERAL (all-category) catalog.
 *
 * Writes structured, search-facing context to products.styling_metadata.occasion
 * (a string[]) + product_taxonomy.style, WITHOUT mutating the human description.
 * This is the relevance signal the search BM25 lane keys off (see migration
 * search_products_v4) and that embed-product's buildDoc already folds into the
 * dense embedding. Re-runnable + non-destructive: it only overwrites the
 * `occasion` key and bumps enrichment_version to 2.
 *
 * The prompt is deliberately category-HONEST: a laundry detergent must get
 * "laundry day / household", NOT "date night". That honesty is what stops
 * unrelated items surfacing for vibe queries.
 *
 * Usage:
 *   set -a && source .env && set +a && node scripts/enrich-occasions-v2.mjs
 *   ... --force   re-enrich everything even if already v2
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://vtarjrnqvcqbhoclvcur.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const FORCE = process.argv.includes('--force');
const ENRICHMENT_VERSION = 2;

if (!SERVICE_KEY)       { console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
if (!ANTHROPIC_API_KEY) { console.error('❌ Missing ANTHROPIC_API_KEY');         process.exit(1); }

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROMPT = (p) => `You write SEARCH metadata for a shopping app that sells ALL kinds of products — clothing, shoes, accessories, beauty, haircare, home decor, books, food, household items, anything.

For the product below, list the real-world OCCASIONS, SETTINGS, ACTIVITIES, and USE-CASES a shopper would have in mind when searching for this exact item. Be HONEST and literal to what the product actually is — do NOT force lifestyle or fashion framing onto utilitarian items.

Examples:
- Cocktail dress → ["date night","cocktail party","wedding guest","night out","dinner party","going out"]
- Laundry detergent → ["laundry day","household chores","stain removal","dorm essentials","everyday cleaning"]
- Romance novel → ["cozy weekend read","beach read","book club","relaxing evening","gift for readers"]
- Running shoes → ["running","gym workout","marathon training","athleisure","everyday sneakers"]
- Scented candle → ["cozy night in","home ambiance","relaxation","housewarming gift","self-care"]
- Cashmere hoodie → ["cozy weekend","lounging at home","travel comfort","chilly evenings","casual layering"]

Product:
  Name: ${p.name}
  Brand: ${p.brand || 'Unknown'}
  Type: ${p.type || 'Unknown'}
  Gender: ${p.gender || 'unisex'}
  Description: ${(p.description || 'n/a').slice(0, 400)}

Rules:
- 4-8 short, lowercase, natural-search phrases. Only ones that GENUINELY fit.
- "style": one word vibe if clearly applicable (minimal, athletic, bohemian, utilitarian, luxury, classic, edgy, preppy, cozy) else null.
Return ONLY JSON: {"occasions":["..."],"style":"..."|null}`;

async function enrich(p) {
  const resp = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 300,
    messages: [{ role: 'user', content: PROMPT(p) }],
  });
  const text = resp.content[0]?.text ?? '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON in response');
  const parsed = JSON.parse(m[0]);
  const occasions = Array.isArray(parsed.occasions)
    ? parsed.occasions.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim().toLowerCase()).slice(0, 8)
    : [];
  const style = typeof parsed.style === 'string' && parsed.style.trim() ? parsed.style.trim().toLowerCase() : null;
  return { occasions, style };
}

async function reembed(id) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/embed-product`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
    body: JSON.stringify({ id, force: true }),
  });
  return r.ok;
}

const { data: products, error } = await supabase
  .from('products')
  .select('id, name, brand, type, gender, description, styling_metadata, product_taxonomy, enrichment_version')
  .eq('is_active', true)
  .order('created_at', { ascending: true });

if (error) { console.error('fetch failed:', error.message); process.exit(1); }

const todo = products.filter((p) => FORCE || (p.enrichment_version ?? 0) < ENRICHMENT_VERSION);
console.log(`\n🏷️  Enrichment v2 — ${todo.length}/${products.length} active products to process${FORCE ? ' (forced)' : ''}\n`);

let ok = 0, fail = 0;
for (let i = 0; i < todo.length; i++) {
  const p = todo[i];
  try {
    const { occasions, style } = await enrich(p);
    if (!occasions.length) { console.log(`  ${i + 1}/${todo.length} ⚠️  no occasions — ${p.name?.slice(0, 40)}`); fail++; continue; }

    const styling = { ...(p.styling_metadata && typeof p.styling_metadata === 'object' ? p.styling_metadata : {}), occasion: occasions };
    const taxonomy = { ...(p.product_taxonomy && typeof p.product_taxonomy === 'object' ? p.product_taxonomy : {}) };
    if (style && !taxonomy.style) taxonomy.style = style;

    const { error: upErr } = await supabase
      .from('products')
      .update({ styling_metadata: styling, product_taxonomy: taxonomy, enrichment_version: ENRICHMENT_VERSION, description_enriched: true })
      .eq('id', p.id);
    if (upErr) { console.log(`  ${i + 1}/${todo.length} ❌ db — ${upErr.message}`); fail++; continue; }

    await reembed(p.id);
    ok++;
    console.log(`  ${i + 1}/${todo.length} ✅ [${p.type || '—'}] ${(p.name || '').slice(0, 38)} → ${occasions.slice(0, 4).join(', ')}`);
    await sleep(250);
  } catch (e) {
    fail++;
    console.log(`  ${i + 1}/${todo.length} ❌ ${(p.name || '').slice(0, 40)} — ${e.message}`);
    await sleep(400);
  }
}

console.log(`\n✅ done: ${ok} enriched, ${fail} failed\n`);
