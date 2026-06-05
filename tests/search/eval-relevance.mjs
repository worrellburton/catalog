#!/usr/bin/env node
/**
 * Relevance eval + gate for the general (all-category) catalog search.
 *
 * Hits a search edge function across a spread of intents — category queries
 * (must stay in-category), vibe queries (must not pull obviously-wrong items),
 * and brand/keyword sanity — and ASSERTS correct behaviour, exiting non-zero on
 * failure so it can gate a search_products change.
 *
 * Usage:
 *   node tests/search/eval-relevance.mjs                      # /search, live function
 *   node tests/search/eval-relevance.mjs --variant=v7         # /search, search_products_v7
 *   SEARCH_VARIANT=v7 node tests/search/eval-relevance.mjs    # same via env
 *   node tests/search/eval-relevance.mjs --endpoint=search-eval --k=12
 *
 * Exit code: 0 if all hard assertions pass, 1 otherwise.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://vtarjrnqvcqbhoclvcur.supabase.co';
const ANON_KEY = process.env.ANON_KEY
  || process.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0YXJqcm5xdmNxYmhvY2x2Y3VyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MTIzNzksImV4cCI6MjA5MDM4ODM3OX0.OMoLmVDtXLw5hL0k7icaBJlIbLPnN9UeCzv8C-o4III';

const args = process.argv.slice(2);
const getArg = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split('=')[1];
  const bare = args.find((a) => !a.startsWith('--'));
  return dflt;
};
const ENDPOINT = getArg('endpoint') || args.find((a) => !a.startsWith('--')) || 'search';
const K = Number(getArg('k') || 12);
const VARIANT = getArg('variant') || process.env.SEARCH_VARIANT || null;

// Footwear surfaces under several (sometimes mis-applied) type labels.
const FOOTWEAR = ['Shoes', 'Sneakers', 'Sandals', 'Loungewear', 'Boots'];
// Apparel "department" — what an aesthetic/trend query must stay within.
const APPAREL = [
  ...FOOTWEAR, 'Top', 'Shirt', 'T-Shirt', 'Shorts', 'Pants', 'Jacket', 'Sweater',
  'Dress', 'Skirt', 'Belt', 'Sunglasses', 'Activewear', 'Hat',
];

/**
 * Each query carries optional HARD assertions (failing → exit 1):
 *   allowedTypes : every returned product_type must be in this set (category purity)
 *   forbid       : no returned name may match any of these regexes
 *   wantTop      : result #1's "brand name" must match this regex
 * and SOFT expectations (warn only):
 *   wantSomeName : at least one result name should match (discovery / recall)
 */
const QUERIES = [
  // ---- category queries: must stay in-category ----
  { q: 'white shoes',    intent: 'category', allowedTypes: FOOTWEAR, forbid: [/\btee\b|t-shirt|dress|jacket|sweater/i], note: 'white footwear; NO tee/shirt' },
  { q: 'white sneakers', intent: 'category', allowedTypes: FOOTWEAR, wantSomeName: [/air force|samba|superstar|achilles|replica/i], note: 'white sneakers' },
  { q: 'black jacket',   intent: 'category', allowedTypes: ['Jacket'], note: 'jackets only' },
  { q: 'summer dress',   intent: 'category', allowedTypes: ['Dress'], note: 'dresses only' },
  { q: 'blue jeans',     intent: 'category', allowedTypes: ['Pants', 'Shorts'], wantTop: /jean|denim/i, note: 'jeans rank above shorts' },
  { q: 'leather boots',  intent: 'category', allowedTypes: FOOTWEAR, note: 'footwear; boots first if any' },
  { q: 'sunglasses',     intent: 'category', allowedTypes: ['Sunglasses'], note: 'eyewear only' },

  // ---- vibe queries: must not pull obviously-wrong items ----
  { q: 'date night',  intent: 'vibe', forbid: [/detergent|psychology of money|\bnovel\b|romance/i], wantSomeName: [/dress|heel|slip/i], note: 'date apparel; NOT detergent/book' },
  { q: 'cozy sunday', intent: 'vibe', forbid: [/detergent|laptop|sparkling water/i], note: 'loungewear/knits/soft home' },

  // ---- aesthetic / trend queries: MUST stay in the apparel department ----
  { q: 'quiet luxury',   intent: 'aesthetic', allowedTypes: APPAREL, note: 'understated apparel; NOT candles/skincare/tech' },
  { q: 'old money',      intent: 'aesthetic', allowedTypes: APPAREL, note: 'classic/tailored apparel; NOT a finance book' },
  { q: 'clean girl',     intent: 'aesthetic', allowedTypes: APPAREL, note: 'minimal/effortless apparel' },
  { q: 'streetwear',     intent: 'aesthetic', allowedTypes: APPAREL, note: 'streetwear apparel/footwear' },
  { q: 'coastal grandma',intent: 'aesthetic', allowedTypes: APPAREL, note: 'linen/relaxed/resort apparel' },

  // ---- occasion queries (recall) ----
  { q: 'wedding guest',  intent: 'occasion', allowedTypes: APPAREL, note: 'dressy apparel' },
  { q: 'job interview',  intent: 'occasion', allowedTypes: APPAREL, note: 'professional apparel' },

  // ---- keyword / brand sanity ----
  { q: 'laundry detergent', intent: 'keyword', wantTop: /tide/i, note: 'Tide should top' },
  { q: 'Nike',              intent: 'brand',   wantTop: /nike/i, note: 'Nike items' },
];

async function search(query, k) {
  const body = { query, k };
  if (VARIANT) body.variant = VARIANT;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${ENDPOINT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { error: `${res.status} ${await res.text()}` };
  return res.json();
}

function assess(spec, results) {
  const hard = [];
  const soft = [];
  const names = results.map((r) => `${r.product_brand ?? ''} ${r.product_name ?? ''}`.trim());
  const types = results.map((r) => r.product_type ?? '—');

  if (spec.allowedTypes) {
    const bad = results.filter((r) => !spec.allowedTypes.includes(r.product_type ?? '—'));
    if (bad.length) hard.push(`leaked ${bad.length} out-of-category: ` + bad.map((r) => `[${r.product_type}] ${r.product_brand} ${(r.product_name ?? '').slice(0, 24)}`).join('; '));
  }
  if (spec.forbid) {
    for (const re of spec.forbid) {
      const hit = names.filter((n) => re.test(n));
      if (hit.length) hard.push(`forbidden match ${re}: ${hit.join('; ')}`);
    }
  }
  if (spec.wantTop) {
    if (!results.length) hard.push(`wantTop ${spec.wantTop} but no results`);
    else if (!spec.wantTop.test(names[0])) hard.push(`top result "${names[0]}" does not match ${spec.wantTop}`);
  }
  if (spec.wantSomeName) {
    for (const re of spec.wantSomeName) {
      if (!names.some((n) => re.test(n))) soft.push(`no result matched ${re} (recall)`);
    }
  }
  return { hard, soft, types };
}

console.log(`\n🔎 Relevance eval — /${ENDPOINT}${VARIANT ? `  variant=${VARIANT}` : '  (live)'}  k=${K}\n`);

let failures = 0;
let warnings = 0;

for (const spec of QUERIES) {
  const data = await search(spec.q, K);
  if (data.error) { console.log(`"${spec.q}" → ERROR ${data.error}\n`); failures++; continue; }
  const results = data.results || [];
  const { hard, soft } = assess(spec, results);

  const status = hard.length ? '❌ FAIL' : soft.length ? '⚠️  WARN' : '✅ PASS';
  failures += hard.length ? 1 : 0;
  warnings += soft.length ? 1 : 0;

  console.log(`${status}  "${spec.q}"  (${results.length} res, ${data.took_ms}ms, ${spec.intent})  — ${spec.note}`);
  results.slice(0, 6).forEach((r, i) => {
    const score = typeof r.score === 'number' ? r.score.toFixed(4) : '?';
    console.log(`     ${String(i + 1).padStart(2)}. ${score}  [${r.product_type ?? '—'}]  ${r.product_brand ?? ''} — ${(r.product_name ?? '').slice(0, 50)}`);
  });
  hard.forEach((h) => console.log(`     ↳ ❌ ${h}`));
  soft.forEach((s) => console.log(`     ↳ ⚠️  ${s}`));
  console.log('');
}

console.log(`──────────\n${failures ? '❌' : '✅'} ${QUERIES.length} queries — ${failures} failed, ${warnings} warned\n`);
process.exit(failures ? 1 : 0);
