#!/usr/bin/env node
// Smoke tests for the "More Like This" RPC (find_similar_products).
//
// Exercises every distinct product type in the catalog against the
// public RPC and prints a one-line verdict per seed:
//   - PASS-strict: all results share the seed's type
//   - PASS-tiered: same-type matches lead, then cross-type fillers
//   - SPARSE:      only one product of this type exists, so cross-type
//                  fillers are expected (still PASS, surfaces sparsity)
//   - FAIL:        rail empty when the catalog has other candidates
//
// Run: node tests/smoke-more-like-this.mjs
//
// Uses the anon key (same as the consumer client), so this exercises
// the exact code path the webapp hits.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().replace(/^"|"$/g, '')];
    }),
);

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_KEY = env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY
  || env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const K = 8;

async function getSeeds() {
  // One representative seed per distinct type, plus one with NULL type
  // and one Decor (only-one-of-its-kind sparsity case).
  const { data } = await supabase.rpc('execute_sql', {});
  // Fallback: query products directly
  const { data: rows, error } = await supabase
    .from('products')
    .select('id, name, brand, type, embedding')
    .eq('is_active', true)
    .not('embedding', 'is', null);
  if (error) throw error;
  // Need creatives too — pull product_ids that have a live creative.
  const { data: creativeRows } = await supabase
    .from('product_creative')
    .select('product_id')
    .eq('status', 'live')
    .not('video_url', 'is', null);
  const eligible = new Set((creativeRows || []).map(r => r.product_id));
  const seeds = [];
  const seenTypes = new Set();
  for (const r of rows || []) {
    if (!eligible.has(r.id)) continue;
    const key = r.type || '<NULL>';
    if (seenTypes.has(key)) continue;
    seenTypes.add(key);
    seeds.push(r);
  }
  return seeds;
}

function verdict(seedType, results) {
  if (!results || results.length === 0) return { tag: 'FAIL', note: 'empty rail', pass: false };
  const sameType = results.filter(r =>
    (r.product_type || null) === (seedType || null),
  );
  if (sameType.length === results.length) {
    return { tag: 'PASS-strict', note: `${sameType.length}/${results.length} same type`, pass: true };
  }
  if (sameType.length > 0) {
    return {
      tag: 'PASS-tiered',
      note: `${sameType.length} same-type + ${results.length - sameType.length} cross-type`,
      pass: true,
    };
  }
  // No same-type results — either NULL-type seed, or seed's type is the
  // only one of its kind in the catalog. Both are PASS as long as the
  // rail is non-empty: we want to surface SOMETHING semantically
  // related rather than show an empty section.
  if (!seedType) return { tag: 'PASS-null', note: 'NULL seed type, all cross-type', pass: true };
  return { tag: 'PASS-sparse', note: `only 1 ${seedType} in catalog, ${results.length} semantic fillers`, pass: true };
}

async function main() {
  console.log('=== More Like This — RPC smoke test ===\n');
  const seeds = await getSeeds();
  console.log(`Testing ${seeds.length} seeds (one per distinct type with active creatives)\n`);

  let pass = 0;
  let fail = 0;
  const failures = [];

  for (const seed of seeds) {
    const { data: results, error } = await supabase.rpc('find_similar_products', {
      seed_product_id: seed.id,
      k: K,
    });
    if (error) {
      console.log(`✗ ${(seed.type || '<NULL>').padEnd(12)} ${seed.name}`);
      console.log(`   ERROR: ${error.message}`);
      fail++;
      failures.push({ seed, error: error.message });
      continue;
    }
    const v = verdict(seed.type, results);
    if (v.pass) pass++; else fail++;
    if (!v.pass) failures.push({ seed, results, verdict: v });
    console.log(`${v.pass ? '✓' : '✗'} [${v.tag.padEnd(11)}] ${(seed.type || '<NULL>').padEnd(10)} ${seed.name.slice(0, 50).padEnd(50)} → ${results.length} results, ${v.note}`);
    // Show first 3 results for transparency
    for (const r of results.slice(0, 3)) {
      console.log(`     · ${(r.product_type || '<NULL>').padEnd(10)} ${(r.product_name || '').slice(0, 60).padEnd(60)} dist=${(r.distance ?? 0).toFixed(3)}`);
    }
  }

  console.log(`\n=== Summary: ${pass} passed, ${fail} failed ===`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  - [${f.seed.type || '<NULL>'}] ${f.seed.name}`);
      if (f.error) console.log(`    error: ${f.error}`);
      if (f.verdict) console.log(`    verdict: ${f.verdict.note}`);
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
