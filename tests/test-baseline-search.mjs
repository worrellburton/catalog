#!/usr/bin/env node
/**
 * Baseline search test - verify basic product searches work
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://vtarjrnqvcqbhoclvcur.supabase.co';
const ANON_KEY = process.env.ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

async function search(query, k = 10) {
  const url = `${SUPABASE_URL}/functions/v1/search`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ANON_KEY}`,
      'apikey': ANON_KEY,
    },
    body: JSON.stringify({ query, k }),
  });
  return await res.json();
}

const tests = [
  'shorts',
  'alo yoga shorts',
  'athletic shorts',
  'game time short'
];

console.log('🔍 Baseline Search Tests\n');

for (const query of tests) {
  const { results, took_ms } = await search(query);
  console.log(`Query: "${query}"`);
  console.log(`Results: ${results.length} (${took_ms}ms)`);
  
  if (results.length > 0) {
    console.log('Top 3:');
    results.slice(0, 3).forEach((r, i) => {
      console.log(`  ${i+1}. ${r.product_name} | ${r.product_brand} | ${r.product_price}`);
    });
  }
  console.log('');
}
