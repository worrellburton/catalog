#!/usr/bin/env node
// Smoke test for search v2 — runs the user's failing queries plus a few
// representative new ones and saves full results to a JSON file for review.
//
// Usage: source .env && ANON=$VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY node tests/search/smoke-v2.mjs

import fs from 'node:fs';

const URL = process.env.VITE_SUPABASE_URL?.replace(/\/$/, '') ?? '';
const ANON = process.env.ANON ?? process.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY ?? '';
if (!URL || !ANON) {
  console.error('Set VITE_SUPABASE_URL and ANON (or VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY)');
  process.exit(2);
}

const QUERIES = [
  // user's failing queries
  'denim',
  'date night',
  'date night outfit',
  'candles',
  'summer outfit',
  'best for summer',
  'best for winter',
  'black jeans combination',
  // additional spot-checks
  'denim jacket',
  'cozy fall vibes',
  'shorts under 80',
  'sneakers under 100',
  'wedding guest',
  'work outfit',
  'leather jacket',
  'cashmere sweater',
  'linen shirt',
  'minimal style',
  'streetwear',
  'quiet luxury',
  'athleisure',
  'y2k',
  'earth tones',
  'running shoes',
  'yoga pants',
  'high waist leggings',
  'cologne',
  'perfume for her',
  'skincare',
  'moisturizer',
  'lipstick',
  'hair cream',
  'toothbrush',
  'scented candle',
];

async function runOne(q) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${URL}/functions/v1/nl-search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ANON}`,
      },
      body: JSON.stringify({ query: q, k: 10 }),
    });
    const elapsed = Date.now() - t0;
    if (!res.ok) {
      return { query: q, ok: false, status: res.status, elapsed_ms: elapsed, error: (await res.text()).slice(0, 200) };
    }
    const json = await res.json();
    const m = json.meta ?? {};
    const e = m.expansion ?? {};
    return {
      query: q,
      ok: true,
      elapsed_ms: elapsed,
      branch: m.branch,
      resolved_types: m.resolved_types,
      bm25_text: m.bm25_text,
      result_count: m.result_count,
      top_score: m.top_score,
      cold_miss: json.cold_miss,
      looks_appended: m.looks_appended,
      products_appended: m.products_appended,
      price_pruned: m.price_pruned,
      pruned_off_type: m.pruned_off_type,
      structured_tokens_count: m.structured_tokens_count,
      expansion: {
        intent:    e.intent,
        types:     e.types,
        keywords:  e.keywords,
        occasions: e.occasions,
        seasons:   e.seasons,
        colors:    e.colors,
        materials: e.materials,
        styles:    e.styles,
        price_max: json.query_plan?.constraints?.price_max,
        source:    e.source,
      },
      results: (json.results ?? []).slice(0, 10).map((r, i) => ({
        rank: i + 1,
        product_id:    r.product_id,
        brand:         r.product_brand,
        name:          r.product_name,
        type:          r.product_type,
        gender:        r.product_gender,
        price:         r.product_price,
        rrf_score:     r.rrf_score,
        dense_rank:    r.dense_rank,
        bm25_rank:     r.bm25_rank,
        type_match:    r.type_match,
      })),
    };
  } catch (err) {
    return { query: q, ok: false, elapsed_ms: Date.now() - t0, error: String(err.message ?? err) };
  }
}

const results = [];
for (const q of QUERIES) {
  const r = await runOne(q);
  results.push(r);
  const tag = r.ok ? 'ok' : 'FAIL';
  const head = (r.results ?? []).slice(0, 3).map(x => `${x.brand}|${(x.name ?? '').slice(0, 40)}|${x.type}`).join('  ;  ');
  console.log(`[${tag}] ${r.elapsed_ms}ms  results=${r.result_count ?? 0}  ${q}  →  ${head}`);
}

const out = {
  generated_at: new Date().toISOString(),
  endpoint: `${URL}/functions/v1/nl-search`,
  query_count: QUERIES.length,
  results,
  summary: {
    avg_ms: Math.round(results.reduce((a, r) => a + (r.elapsed_ms ?? 0), 0) / results.length),
    max_ms: Math.max(...results.map(r => r.elapsed_ms ?? 0)),
    p95_ms: (() => {
      const sorted = results.map(r => r.elapsed_ms ?? 0).sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length * 0.95)];
    })(),
    cold_miss_count: results.filter(r => r.cold_miss).length,
    empty_count:     results.filter(r => (r.result_count ?? 0) === 0).length,
    ok_count:        results.filter(r => r.ok).length,
  },
};

const path = `tests/search/smoke-v2-results.json`;
fs.writeFileSync(path, JSON.stringify(out, null, 2));
console.log(`\n[smoke-v2] saved → ${path}`);
console.log(`[smoke-v2] summary: avg=${out.summary.avg_ms}ms  p95=${out.summary.p95_ms}ms  empty=${out.summary.empty_count}  cold_miss=${out.summary.cold_miss_count}`);
