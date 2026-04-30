#!/usr/bin/env node
/**
 * test-fast-path — verifies the tier-1 catalog fast-path against the live DB.
 *
 * Runs each test term through the same query used by getCreativesByCatalogTag(),
 * measures round-trip time, prints a table, and writes results.json.
 *
 * Usage (keys are already in .env — pass them or export them first):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node agents/seed-query-embeddings/test-fast-path.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// Mirror of CATALOG_TYPE_SYNONYMS in product-creative.ts
const CATALOG_TYPE_SYNONYMS = {
  shoes:        ['Sneakers', 'Boots', 'Sandals', 'Heels', 'Loafers', 'Flats', 'Mules'],
  sneakers:     ['Sneakers'],
  boots:        ['Boots'],
  sandals:      ['Sandals'],
  tops:         ['Top'],
  shirts:       ['Top'],
  pants:        ['Pants'],
  trousers:     ['Pants'],
  jeans:        ['Pants'],
  shorts:       ['Shorts'],
  skirts:       ['Skirt'],
  dresses:      ['Dress'],
  dress:        ['Dress'],
  jackets:      ['Jacket'],
  coats:        ['Coat'],
  hats:         ['Hat'],
  bags:         ['Bag'],
  activewear:   ['Activewear'],
  underwear:    ['Underwear'],
  swimwear:     ['Swimwear'],
};

// Terms to test — mirrors the ones the user tried ("shoes", "pants") plus
// a few extras and two deliberate misses to confirm cold-path falls through.
const TEST_TERMS = [
  'shoes',
  'pants',
  'tops',
  'shirts',
  'jackets',
  'shorts',
  'dresses',
  'hats',
  'activewear',
  'sneakers',
  // Miss cases — no synonym mapping, should return 0 rows and not commit
  'furniture',
  'blazer',
];

// ── In-memory filter simulation ───────────────────────────────────────────
// Mirrors what ContinuousFeed does in tier-1: filter already-loaded
// liveCreatives by product.type. This should be ~0 ms.
function filterInMemory(liveCreatives, term) {
  const types = resolveCatalogTypes(term);
  if (!types) return [];
  return liveCreatives.filter(c => types.includes(c.product?.type));
}

function resolveCatalogTypes(query) {
  const key = query.trim().toLowerCase();
  return CATALOG_TYPE_SYNONYMS[key] || null;
}

async function runQuery(term) {
  const types = resolveCatalogTypes(term);
  if (!types) {
    return { rows: [], resolvedTypes: null, tier1Hit: false };
  }

  const { data, error } = await supabase
    .from('product_creative')
    .select(`
      id,
      video_url,
      status,
      product:products!inner(id, name, brand, type, gender, is_active)
    `)
    .eq('status', 'live')
    .not('video_url', 'is', null)
    .in('product.type', types)
    .order('created_at', { ascending: false })
    .limit(60);

  if (error) throw new Error(error.message);

  // Mirror the is_active filter from getCreativesByCatalogTag
  const filtered = (data || []).filter(r => r.product?.is_active !== false);
  return { rows: filtered, resolvedTypes: types, tier1Hit: filtered.length > 0 };
}

async function main() {
  console.log(`\nTesting tier-1 fast-path against ${SUPABASE_URL}\n`);

  // ── Phase 0: load liveCreatives (what the app does on mount) ─────────────
  const t0load = performance.now();
  const { data: liveCreativesRaw, error: liveErr } = await supabase
    .from('product_creative')
    .select('*, product:products(id, name, brand, price, image_url, images, url, type, catalog_tags, is_active, is_elite, gender)')
    .eq('status', 'live')
    .not('video_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200);
  const loadMs = Math.round(performance.now() - t0load);
  if (liveErr) { console.error('Failed to load live creatives:', liveErr.message); process.exit(1); }
  const liveCreatives = (liveCreativesRaw || []).filter(r => r.product?.is_active !== false);
  console.log(`liveCreatives loaded: ${liveCreatives.length} rows in ${loadMs}ms (one-time on app mount)\n`);

  // ── Phase 1: in-memory filter (tier-1 fast path) ─────────────────────────
  console.log('── TIER-1 IN-MEMORY (no network, ~0ms expected) ──────────────────────');
  console.log('Term'.padEnd(14), 'Types matched'.padEnd(35), 'Rows'.padEnd(6), 'Time (ms)');
  console.log('-'.repeat(65));
  const inMemResults = [];
  for (const term of TEST_TERMS) {
    const t1 = performance.now();
    const matched = filterInMemory(liveCreatives, term);
    const elapsed = Math.round(performance.now() - t1);
    const typesStr = resolveCatalogTypes(term)?.join(', ') ?? '(no synonym)';
    console.log(term.padEnd(14), typesStr.padEnd(35), String(matched.length).padEnd(6), `${elapsed}ms`);
    inMemResults.push({ term, rows: matched.length, ms: elapsed });
  }

  // ── Phase 2: DB round-trip (tier-2, runs only when in-memory has 0 rows) ─
  console.log('\n── TIER-2 DB ROUND-TRIP (only for cache misses) ─────────────────────');
  console.log('Term'.padEnd(14), 'Resolved types'.padEnd(35), 'Rows'.padEnd(6), 'Time (ms)'.padEnd(12), 'Hit?');
  console.log('-'.repeat(75));

  const results = [];
  for (const term of TEST_TERMS) {
    const t1 = performance.now();
    let outcome;
    try {
      outcome = await runQuery(term);
    } catch (err) {
      outcome = { rows: [], resolvedTypes: null, tier1Hit: false, error: err.message };
    }
    const ms = Math.round(performance.now() - t1);
    const typesStr = outcome.resolvedTypes ? outcome.resolvedTypes.join(', ') : '(no synonym)';
    const hitStr   = outcome.tier1Hit ? '✓ HIT' : '✗ miss';
    console.log(term.padEnd(14), typesStr.padEnd(35), String(outcome.rows.length).padEnd(6), `${ms}ms`.padEnd(12), hitStr);
    results.push({
      term,
      resolvedTypes: outcome.resolvedTypes,
      inMemoryRows: inMemResults.find(r => r.term === term)?.rows ?? 0,
      inMemoryMs:   inMemResults.find(r => r.term === term)?.ms ?? 0,
      dbRows: outcome.rows.length,
      dbMs: ms,
      tier1Hit: outcome.tier1Hit,
      error: outcome.error || null,
      sample: outcome.rows.slice(0, 3).map(r => ({
        creative_id: r.id,
        product_name: r.product?.name,
        product_brand: r.product?.brand,
        product_type: r.product?.type,
        gender: r.product?.gender,
      })),
    });
  }

  const hits   = results.filter(r => r.tier1Hit).length;
  const misses = results.filter(r => !r.tier1Hit).length;
  const avgDb  = Math.round(results.filter(r => r.tier1Hit).reduce((s, r) => s + r.dbMs, 0) / (hits || 1));
  const maxDb  = Math.max(...results.filter(r => r.tier1Hit).map(r => r.dbMs));

  console.log('-'.repeat(75));
  console.log(`\nSummary:`);
  console.log(`  liveCreatives load: ${loadMs}ms (once on app mount)`);
  console.log(`  In-memory filter:   ~0ms (zero network after load)`);
  console.log(`  DB round-trip:      avg ${avgDb}ms, max ${maxDb}ms (${hits} hits / ${misses} misses)`);
  console.log(`  vs nl-search:       4000-8000ms (baseline)`);
  console.log(`\nConclusion: tier-1 in-memory is ${Math.round(6000 / Math.max(1, avgDb))}× faster than nl-search at the DB tier,`);
  console.log(`  and truly instant (~0ms) after the initial liveCreatives load.\n`);

  const outPath = join(dirname(fileURLToPath(import.meta.url)), 'test-fast-path-results.json');
  writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), liveCreativesLoadMs: loadMs, liveCreativesCount: liveCreatives.length, summary: { hits, misses, avgDbMs: avgDb, maxDbMs: maxDb }, results }, null, 2));
  console.log(`Results saved → ${outPath}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
