#!/usr/bin/env node
/**
 * Relevance eval for the general (all-category) catalog search.
 *
 * Hits a search edge function for a spread of intents — vibe queries, keyword
 * queries, brand queries, and cross-category gift queries — and prints the
 * ranked products so relevance can be eyeballed and diffed before/after a
 * search_products change.
 *
 * Usage:
 *   node tests/search/eval-relevance.mjs                 # hits /search (prod)
 *   node tests/search/eval-relevance.mjs search-eval     # hits a shadow fn
 *   node tests/search/eval-relevance.mjs search-eval 12  # top-k
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://vtarjrnqvcqbhoclvcur.supabase.co';
const ANON_KEY = process.env.ANON_KEY
  || process.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0YXJqcm5xdmNxYmhvY2x2Y3VyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MTIzNzksImV4cCI6MjA5MDM4ODM3OX0.OMoLmVDtXLw5hL0k7icaBJlIbLPnN9UeCzv8C-o4III';

const ENDPOINT = process.argv[2] || 'search';
const K = Number(process.argv[3] || 10);

// query → what a relevant result looks like (for human scoring, not enforced)
const QUERIES = [
  { q: 'date night',         note: 'date-appropriate apparel; NOT detergent/candle/random book' },
  { q: 'cozy sunday',        note: 'loungewear, knits, soft home; vibe' },
  { q: 'summer beach',       note: 'swim, sandals, hats, linen; vibe' },
  { q: 'home office',        note: 'desk/decor/home; cross-category' },
  { q: 'gift for mom',       note: 'broad cross-category; loose' },
  { q: 'white sneakers',     note: 'AF1 / Samba; keyword' },
  { q: 'laundry detergent',  note: 'Tide SHOULD top this; keyword sanity' },
  { q: 'skincare',           note: 'beauty/haircare; keyword' },
  { q: 'black dress',        note: 'dresses; keyword' },
  { q: 'Nike',               note: 'Nike items; brand' },
];

async function search(query, k) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${ENDPOINT}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ANON_KEY}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify({ query, k }),
  });
  if (!res.ok) return { error: `${res.status} ${await res.text()}` };
  return res.json();
}

console.log(`\n🔎 Relevance eval — endpoint=/${ENDPOINT}  k=${K}\n`);

for (const { q, note } of QUERIES) {
  const data = await search(q, K);
  if (data.error) { console.log(`"${q}" → ERROR ${data.error}\n`); continue; }
  const results = data.results || [];
  console.log(`"${q}"  (${results.length} results, ${data.took_ms}ms)  — want: ${note}`);
  results.forEach((r, i) => {
    const score = typeof r.score === 'number' ? r.score.toFixed(4) : '?';
    console.log(`  ${String(i + 1).padStart(2)}. ${score}  [${r.product_type ?? '—'}]  ${r.product_brand ?? ''} — ${(r.product_name ?? '').slice(0, 56)}`);
  });
  console.log('');
}
