#!/usr/bin/env node
// SEARCH_V3 cache prewarm — fires the top-N golden queries through the
// deployed nl-search edge function so the in-memory expansion cache
// (cache_v=EXPANSION_V) is populated before real users hit cold paths.
//
// Run after deploying nl-search or bumping EXPANSION_V.
//
// Usage:
//   set -a && source .env && set +a
//   node scripts/prewarm-cache.mjs                # top 50 queries
//   node scripts/prewarm-cache.mjs --top=86       # all golden queries
//   node scripts/prewarm-cache.mjs --concurrency=2

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  })
);
const TOP = parseInt(args.top ?? '50', 10);
const CONCURRENCY = parseInt(args.concurrency ?? '3', 10);

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY     = process.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
if (!SUPABASE_URL || !ANON_KEY) {
  console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY (source .env)');
  process.exit(2);
}

const goldenPath = path.resolve(process.cwd(), 'tests/search/golden.jsonl');
const lines = (await readFile(goldenPath, 'utf8'))
  .split('\n')
  .map(l => l.trim())
  .filter(Boolean);

const queries = lines
  .slice(0, TOP)
  .map(line => {
    try { return JSON.parse(line).query; } catch { return null; }
  })
  .filter(Boolean);

console.log(`[prewarm] firing ${queries.length} queries (concurrency=${CONCURRENCY})`);

let done = 0, failed = 0;
const start = Date.now();

async function ping(query) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/nl-search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify({ query, k: 10 }),
    });
    if (!res.ok) {
      failed++;
      console.warn(`[fail] "${query}" → ${res.status}`);
      return;
    }
    const data = await res.json();
    const src = data?.meta?.expansion?._source ?? data?.meta?.expansion?.source ?? '?';
    if (++done % 10 === 0) {
      console.log(`[prewarm] ${done}/${queries.length} done (last="${query}" src=${src})`);
    }
  } catch (err) {
    failed++;
    console.warn(`[fail] "${query}" → ${err?.message ?? err}`);
  }
}

const queue = [...queries];
const workers = Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const q = queue.shift();
    if (q) await ping(q);
  }
});
await Promise.all(workers);

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
console.log(`[prewarm] done. ${done - failed} ok, ${failed} failed in ${elapsed}s`);
