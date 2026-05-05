#!/usr/bin/env node
/**
 * Phase C local test — embedding quality without the SQL type guardrail
 *
 * Strategy:
 *   1. Pull prewarmed query embeddings + expansions from the CLOUD cache
 *      (cloud nl-search must have been called recently so rows exist in
 *      query_embeddings). Falls back to calling cloud nl-search on-demand.
 *   2. Run search_products_with_creatives against LOCAL Supabase (509 active
 *      products) — once with filter_types (current V3) and once without
 *      (Phase C proposal).
 *   3. Score each query against the golden set and write a side-by-side
 *      comparison to tests/search/phase-c-results.json.
 *
 * Prerequisites:
 *   supabase start                                 (local running)
 *   source .env                                    (cloud keys + DB URL)
 *   node scripts/prewarm-cache.mjs --top=86        (populates cloud cache)
 *   node tests/search/test-phase-c.mjs
 *
 * The script needs:
 *   VITE_SUPABASE_URL          — cloud URL (for pulling cached embeddings)
 *   VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY — cloud anon key
 *   SUPABASE_SERVICE_ROLE_KEY  — used for local DB direct query
 *
 * LOCAL_DB_URL defaults to postgresql://postgres:postgres@127.0.0.1:54322/postgres
 */

import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// ── Config ─────────────────────────────────────────────────────────────────
const CLOUD_URL     = process.env.VITE_SUPABASE_URL;
const CLOUD_ANON    = process.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
const CLOUD_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY; // bypasses RLS on query_embeddings
const LOCAL_DB      = process.env.LOCAL_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const LOCAL_URL     = 'http://127.0.0.1:54321';
const LOCAL_ANON    = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'; // from supabase status
const K = 24;
const EMBED_V     = 1; // must match index.ts EMBED_V
const EXPANSION_V = 5; // must match index.ts EXPANSION_V

if (!CLOUD_URL || !CLOUD_ANON) {
  console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY (source .env)');
  process.exit(2);
}

// ── Load golden set ─────────────────────────────────────────────────────────
const goldenPath = path.resolve(process.cwd(), 'tests/search/golden.jsonl');
const golden = (await readFile(goldenPath, 'utf8'))
  .split('\n').map(l => l.trim()).filter(Boolean)
  .map(l => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean);

console.log(`[phase-c] ${golden.length} golden queries`);

// ── Clients ─────────────────────────────────────────────────────────────────
// Use service-role for cloud to bypass RLS on query_embeddings table.
const cloud = createClient(CLOUD_URL, CLOUD_SERVICE ?? CLOUD_ANON);
const local = createClient(LOCAL_URL, LOCAL_ANON);
const db    = new pg.Client({ connectionString: LOCAL_DB });
await db.connect();

// ── Helpers ─────────────────────────────────────────────────────────────────
function normalizeQuery(q) {
  return q.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function parsePgVector(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw;
  const str = typeof raw === 'string' ? raw : String(raw);
  const inner = str.replace(/^\[/, '').replace(/\]$/, '');
  return inner.split(',').map(Number);
}

function mrr(results, gold) {
  if (!gold.expect_name_includes?.length) return null;
  for (let i = 0; i < results.length; i++) {
    const name = (results[i].product_name ?? '').toLowerCase();
    const hit  = gold.expect_name_includes.some(kw => name.includes(kw.toLowerCase()));
    if (hit) return 1 / (i + 1);
  }
  return 0;
}

function catPrecision(results, gold) {
  if (!gold.expect_category?.length) return null;
  const cats = new Set(gold.expect_category.map(c => c.toLowerCase()));
  const inCat = results.filter(r => cats.has((r.product_type ?? '').toLowerCase())).length;
  return inCat / results.length;
}

// ── Step 1: pull cached embeddings from cloud ────────────────────────────────
console.log('[phase-c] fetching query embeddings from cloud cache...');
const queryEmbeddings = new Map(); // normalizedQuery → { embedding, expansion }

// Fetch all at once (cloud query_embeddings table is public-readable via service role)
// Fallback: call cloud nl-search for queries whose cache has expired.
const queries = golden.map(g => normalizeQuery(g.query));

// Batch-fetch from cloud cache (service role bypasses RLS)
const { data: cacheRows, error: cacheErr } = await cloud
  .from('query_embeddings')
  .select('query_text, embedding, expansion, embedding_v, expansion_v')
  .in('query_text', queries)
  .limit(200);

if (cacheErr) {
  console.warn('[phase-c] cache fetch error:', cacheErr.message);
}

let cacheHits = 0;
for (const row of (cacheRows ?? [])) {
  const emb = row.embedding_v === EMBED_V ? parsePgVector(row.embedding) : null;
  const exp = row.expansion_v === EXPANSION_V ? row.expansion : null;
  if (emb) {
    queryEmbeddings.set(row.query_text, { embedding: emb, expansion: exp });
    cacheHits++;
  }
}
console.log(`[phase-c] cache hits: ${cacheHits}/${queries.length}`);

// For any misses, call cloud nl-search (which will embed + cache)
const misses = golden.filter(g => !queryEmbeddings.has(normalizeQuery(g.query)));
if (misses.length > 0) {
  console.log(`[phase-c] fetching ${misses.length} cache misses from cloud nl-search...`);
  for (const g of misses) {
    try {
      const res = await fetch(`${CLOUD_URL}/functions/v1/nl-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CLOUD_ANON}` },
        body: JSON.stringify({ query: g.query, k: 5 }),
      });
      if (!res.ok) { console.warn(`[miss] "${g.query}" → HTTP ${res.status}`); continue; }
      const data = await res.json();
      // Try cache again with service role key after the nl-search call writes it
      const key = normalizeQuery(g.query);
      const { data: row } = await cloud
        .from('query_embeddings')
        .select('embedding, expansion, embedding_v, expansion_v')
        .eq('query_text', key)
        .maybeSingle();
      if (row) {
        const emb = row.embedding_v === EMBED_V ? parsePgVector(row.embedding) : null;
        const exp = row.expansion_v === EXPANSION_V ? row.expansion : null;
        // Fall back to query_plan from the response if cache still has wrong version
        const expansion = exp ?? data?.query_plan ?? data?.meta?.expansion ?? null;
        if (emb) queryEmbeddings.set(key, { embedding: emb, expansion });
      } else if (data?.meta?.expansion) {
        // Cache write may be async; use the response meta as a fallback for expansion
        // We still need the embedding — nothing we can do without the key
        console.warn(`[miss] "${g.query}" — no cache row after nl-search call`);
      }
    } catch (e) {
      console.warn(`[miss] "${g.query}":`, e.message);
    }
  }
  console.log(`[phase-c] total embeddings ready: ${queryEmbeddings.size}/${queries.length}`);
}

// ── Step 2: run RPC locally ──────────────────────────────────────────────────
async function runLocalSearch(embedding, filterTypes, gender = null) {
  const embStr = `[${embedding.join(',')}]`;
  const { data, error } = await local.rpc('search_products_with_creatives', {
    query_embedding: embStr,
    query_text:      '',     // BM25 not used here — pure vector
    k:               K,
    filter_gender:   gender,
    filter_types:    filterTypes,
    require_elite:   false,
    exclude_ids:     [],
  });
  if (error) {
    console.warn('[rpc error]', error.message);
    return [];
  }
  return data ?? [];
}

// ── Step 3: score and compare ────────────────────────────────────────────────
const results = [];
let v3Found = 0, phCFound = 0;
let v3Mrr = 0, phCMrr = 0;
let counted = 0;

for (const g of golden) {
  const key = normalizeQuery(g.query);
  const cached = queryEmbeddings.get(key);
  if (!cached?.embedding) {
    results.push({ query: g.query, skip: 'no_embedding' });
    continue;
  }

  const { embedding, expansion } = cached;

  // Determine V3 filterTypes from expansion (same logic as nl-search Step 3)
  const v3FilterTypes =
    expansion?.intent === 'pairing' ? (expansion.pair_types ?? null)
    : expansion?.intent === 'browse' && expansion?.types?.length > 0 ? expansion.types
    : null;

  // Run both in parallel
  const [v3Rows, phCRows] = await Promise.all([
    runLocalSearch(embedding, v3FilterTypes),
    runLocalSearch(embedding, null),            // Phase C: no type filter
  ]);

  const v3Score  = mrr(v3Rows,  g);
  const phCScore = mrr(phCRows, g);
  const v3Cat    = catPrecision(v3Rows,  g);
  const phCCat   = catPrecision(phCRows, g);
  const v3Hit    = (v3Score  ?? 0) > 0;
  const phCHit   = (phCScore ?? 0) > 0;

  if (v3Hit)  v3Found++;
  if (phCHit) phCFound++;
  if (v3Score  != null) { v3Mrr  += v3Score;  counted++; }
  if (phCScore != null)   phCMrr += phCScore;

  results.push({
    query:         g.query,
    intent:        g.intent,
    expect_category:     g.expect_category,
    expect_name_includes: g.expect_name_includes,
    expansion: {
      intent:     expansion?.intent,
      types:      expansion?.types,
      keywords:   expansion?.keywords,
    },
    v3: {
      filter_types:      v3FilterTypes,
      mrr:               v3Score,
      cat_precision:     v3Cat,
      found:             v3Hit,
      top5: v3Rows.slice(0, 5).map(r => ({
        name:          r.product_name,
        type:          r.product_type,
        brand:         r.product_brand,
        is_placeholder: r.is_placeholder,
        rrf_score:     r.rrf_score,
      })),
    },
    phase_c: {
      filter_types:      null,
      mrr:               phCScore,
      cat_precision:     phCCat,
      found:             phCHit,
      top5: phCRows.slice(0, 5).map(r => ({
        name:          r.product_name,
        type:          r.product_type,
        brand:         r.product_brand,
        is_placeholder: r.is_placeholder,
        rrf_score:     r.rrf_score,
      })),
    },
    verdict: phCHit && !v3Hit ? 'PHASE_C_WINS'
           : v3Hit  && !phCHit ? 'V3_WINS'
           : phCHit && v3Hit   ? 'BOTH_FOUND'
           : 'BOTH_MISS',
  });
}

await db.end();

// ── Step 4: summary ──────────────────────────────────────────────────────────
const total  = golden.length;
const scored = results.filter(r => !r.skip).length;
const phCWins   = results.filter(r => r.verdict === 'PHASE_C_WINS').length;
const v3Wins    = results.filter(r => r.verdict === 'V3_WINS').length;
const bothFound = results.filter(r => r.verdict === 'BOTH_FOUND').length;
const bothMiss  = results.filter(r => r.verdict === 'BOTH_MISS').length;

console.log('\n──── Phase C Test Summary (local, 509 products) ────');
console.log(`  queries tested:     ${scored}/${total}`);
console.log(`  V3 (type filter):   ${v3Found}/${scored} found@K  |  MRR=${(v3Mrr/counted).toFixed(3)}`);
console.log(`  Phase C (no filter):${phCFound}/${scored} found@K  |  MRR=${(phCMrr/counted).toFixed(3)}`);
console.log(`  PHASE_C_WINS:  ${phCWins}  (Phase C found; V3 missed)`);
console.log(`  V3_WINS:       ${v3Wins}  (V3 found; Phase C missed)`);
console.log(`  BOTH_FOUND:    ${bothFound}`);
console.log(`  BOTH_MISS:     ${bothMiss}`);

const output = {
  generated_at: new Date().toISOString(),
  local_products_active: 509,
  local_creatives_live:  190,
  k: K,
  summary: {
    queries_tested:   scored,
    v3_found_at_k:    v3Found,
    phase_c_found_at_k: phCFound,
    v3_mrr:           parseFloat((v3Mrr/counted).toFixed(3)),
    phase_c_mrr:      parseFloat((phCMrr/counted).toFixed(3)),
    phase_c_wins: phCWins,
    v3_wins:      v3Wins,
    both_found:   bothFound,
    both_miss:    bothMiss,
  },
  results,
};

const outPath = path.resolve(process.cwd(), 'tests/search/phase-c-results.json');
await writeFile(outPath, JSON.stringify(output, null, 2));
console.log(`\n[phase-c] results saved to ${outPath}`);
