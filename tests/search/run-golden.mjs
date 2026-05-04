#!/usr/bin/env node
/**
 * Search eval harness — runs golden.jsonl queries against the deployed
 * nl-search edge function and reports recall/precision/MRR.
 *
 * Usage:
 *   node tests/search/run-golden.mjs              # uses .env defaults
 *   FUNCTIONS_URL=... ANON_KEY=... node tests/search/run-golden.mjs
 *   node tests/search/run-golden.mjs --query "candles"   # one-off
 *   node tests/search/run-golden.mjs --json              # machine output
 *   node tests/search/run-golden.mjs --warm              # double-pass for warm timing
 *
 * Metrics per query:
 *   - found@10           1 if any top-10 result matches expectations, else 0
 *   - cat_precision@10   fraction of top-10 whose product_type ∈ expect_category
 *   - mrr@10             1/rank of first matching result, 0 if none in top-10
 *   - latency_ms         end-to-end POST latency
 *
 * A query "matches" when EITHER:
 *   - product_type is in expect_category, OR
 *   - product_name (lowercase) contains any expect_name_includes substring
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = path.resolve(__dirname, '..', '..');
const GOLDEN_FP  = path.join(__dirname, 'golden.jsonl');

const args     = new Set(process.argv.slice(2));
const wantJson = args.has('--json');
const wantWarm = args.has('--warm');
const oneQuery = (() => {
  const i = process.argv.indexOf('--query');
  return i >= 0 ? process.argv[i + 1] : null;
})();

function readEnv() {
  const envFp = path.join(REPO_ROOT, '.env');
  const env   = {};
  if (fs.existsSync(envFp)) {
    for (const line of fs.readFileSync(envFp, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  const supabaseUrl = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL || '';
  const fnUrl       = process.env.FUNCTIONS_URL
                    || (supabaseUrl ? `${supabaseUrl}/functions/v1` : '')
                    || 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1';
  const anon        = process.env.ANON_KEY
                    || env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY
                    || '';
  if (!anon) {
    throw new Error('Anon key not found. Set ANON_KEY or VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY in .env');
  }
  return { fnUrl, anon };
}

function loadGolden() {
  const lines = fs.readFileSync(GOLDEN_FP, 'utf8').split('\n').filter(Boolean);
  return lines.map((l, i) => {
    try { return JSON.parse(l); }
    catch (e) { throw new Error(`Bad JSONL line ${i + 1}: ${e.message}`); }
  });
}

async function search(fnUrl, anon, query, k = 10) {
  const t0 = Date.now();
  const res = await fetch(`${fnUrl}/nl-search`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${anon}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ query, k }),
  });
  const ms = Date.now() - t0;
  if (!res.ok) {
    return { ms, results: [], error: `HTTP ${res.status}` };
  }
  const body = await res.json();
  return { ms, results: body.results || [], meta: body.meta };
}

function evaluate(row, results) {
  const expectCat   = new Set((row.expect_category || []).map(s => s.toLowerCase()));
  const expectSubs  = (row.expect_name_includes || []).map(s => s.toLowerCase());
  const top         = results.slice(0, 10);

  let firstHitRank = 0;
  let catHits      = 0;
  for (let i = 0; i < top.length; i++) {
    const r        = top[i];
    const type     = (r.product_type || '').toLowerCase();
    const name     = (r.product_name || '').toLowerCase();
    const catMatch = expectCat.size > 0 && expectCat.has(type);
    const subMatch = expectSubs.some(s => name.includes(s));
    if (catMatch) catHits++;
    if ((catMatch || subMatch) && firstHitRank === 0) firstHitRank = i + 1;
  }

  // For "intent: vibe" with no expectations, just check the call returned results.
  const noExpectations = expectCat.size === 0 && expectSubs.length === 0;
  const found  = noExpectations ? (top.length > 0 ? 1 : 0) : (firstHitRank > 0 ? 1 : 0);
  const mrr    = firstHitRank > 0 ? 1 / firstHitRank : 0;
  const catPre = expectCat.size > 0 ? catHits / Math.max(top.length, 1) : null;

  return { found, mrr, cat_precision: catPre, top_count: top.length };
}

function summarise(rows) {
  const n = rows.length;
  const acc = (k) => rows.reduce((s, r) => s + (r[k] ?? 0), 0) / n;
  const catRows = rows.filter(r => r.cat_precision != null);
  return {
    n,
    found_at_10:           +(acc('found') * 100).toFixed(1),
    mrr_at_10:             +acc('mrr').toFixed(3),
    cat_precision_at_10:   catRows.length
      ? +(catRows.reduce((s, r) => s + r.cat_precision, 0) / catRows.length * 100).toFixed(1)
      : null,
    p50_latency_ms:        percentile(rows.map(r => r.latency_ms), 0.5),
    p95_latency_ms:        percentile(rows.map(r => r.latency_ms), 0.95),
    avg_latency_ms:        Math.round(acc('latency_ms')),
  };
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx    = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

function fmtRow(r) {
  const tag = r.found ? '✓' : '✗';
  const cat = r.cat_precision == null ? ' -- ' : `${(r.cat_precision * 100).toFixed(0).padStart(3)}%`;
  return `  ${tag} ${String(r.latency_ms).padStart(5)}ms  cat=${cat}  mrr=${r.mrr.toFixed(2)}  ${r.intent.padEnd(7)} ${r.query}`;
}

async function main() {
  const { fnUrl, anon } = readEnv();
  let golden = loadGolden();
  if (oneQuery) golden = golden.filter(g => g.query === oneQuery);
  if (golden.length === 0) {
    console.error(`No golden rows ${oneQuery ? `match query="${oneQuery}"` : 'found'}.`);
    process.exit(1);
  }

  if (!wantJson) {
    console.log(`[eval] ${golden.length} queries → ${fnUrl}/nl-search${wantWarm ? ' (warm pass)' : ''}`);
  }

  const rows = [];
  for (const g of golden) {
    if (wantWarm) {
      // Cold-prime so the warm pass measures the cache-hit path.
      await search(fnUrl, anon, g.query, 10).catch(() => null);
    }
    const { ms, results, error } = await search(fnUrl, anon, g.query, 10);
    if (error) {
      const row = { query: g.query, intent: g.intent || '?', latency_ms: ms, error,
                    found: 0, mrr: 0, cat_precision: null, top_count: 0 };
      rows.push(row);
      if (!wantJson) console.log(`  ✗ ERR ${error.padEnd(10)} ${g.query}`);
      continue;
    }
    const ev = evaluate(g, results);
    const row = { query: g.query, intent: g.intent || '?', latency_ms: ms, ...ev };
    rows.push(row);
    if (!wantJson) console.log(fmtRow(row));
  }

  const sum = summarise(rows);

  if (wantJson) {
    console.log(JSON.stringify({ summary: sum, rows }, null, 2));
    return;
  }

  console.log('\n──── summary ────');
  console.log(`  queries:                  ${sum.n}`);
  console.log(`  found@10:                 ${sum.found_at_10}%`);
  console.log(`  mrr@10:                   ${sum.mrr_at_10}`);
  console.log(`  cat_precision@10:         ${sum.cat_precision_at_10 == null ? 'n/a' : sum.cat_precision_at_10 + '%'}`);
  console.log(`  latency p50/p95/avg (ms): ${sum.p50_latency_ms} / ${sum.p95_latency_ms} / ${sum.avg_latency_ms}`);

  // Exit non-zero if found@10 < 80% so this can be wired into CI.
  if (sum.found_at_10 < 80) {
    console.error(`\n[eval] FAIL: found@10 (${sum.found_at_10}%) below 80% threshold`);
    process.exit(2);
  }
}

main().catch(err => {
  console.error('[eval] error:', err);
  process.exit(1);
});
