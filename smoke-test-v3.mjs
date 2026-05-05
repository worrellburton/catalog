#!/usr/bin/env node
// Smoke test for Search V3 (gte-small + products-primary)
// Tests basic search functionality and saves results to JSON

import { readFileSync } from 'fs';
import { writeFileSync } from 'fs';

const ENV_FILE = '.env';
const envContent = readFileSync(ENV_FILE, 'utf-8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const [key, ...valueParts] = trimmed.split('=');
  if (key && valueParts.length) {
    env[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
  }
}

const SUPABASE_URL = env.VITE_SUPABASE_URL || 'https://vtarjrnqvcqbhoclvcur.supabase.co';
const ANON_KEY = env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

if (!ANON_KEY) {
  console.error('Missing VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY in .env');
  process.exit(1);
}

const SEARCH_URL = `${SUPABASE_URL}/functions/v1/search`;

const SMOKE_QUERIES = [
  { query: 'shoes', k: 10, description: 'Basic footwear query' },
  { query: 'black leather boots', k: 10, description: 'Specific product search' },
  { query: 'sunglasses', k: 10, description: 'Accessories' },
  { query: 'jacket', k: 10, description: 'Outerwear' },
  { query: 'dress', k: 10, description: 'Womens clothing' },
  { query: 'sneakers', k: 10, description: 'Athletic footwear' },
  { query: 'handbag', k: 10, description: 'Bags & accessories' },
  { query: 'watch', k: 10, description: 'Jewelry & watches' },
];

async function searchV3(query, k = 24, gender = null, exclude_ids = []) {
  const body = { query, k };
  if (gender) body.gender = gender;
  if (exclude_ids.length) body.exclude_ids = exclude_ids;

  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ANON_KEY}`,
      'apikey': ANON_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Search failed (${res.status}): ${text}`);
  }

  return await res.json();
}

async function runSmokeTests() {
  console.log('🔍 Search V3 Smoke Tests\n');
  console.log(`Endpoint: ${SEARCH_URL}`);
  console.log(`Queries: ${SMOKE_QUERIES.length}\n`);

  const results = [];
  let passed = 0;
  let failed = 0;

  for (const test of SMOKE_QUERIES) {
    const { query, k, description } = test;
    process.stdout.write(`Testing: "${query}" (${description})... `);

    try {
      const start = Date.now();
      const result = await searchV3(query, k);
      const took = Date.now() - start;

      const count = result.results?.length || 0;
      const hasResults = count > 0;
      const status = hasResults ? '✓' : '✗';
      
      console.log(`${status} ${count} results (${took}ms, ${result.took_ms}ms server)`);

      results.push({
        query,
        k,
        description,
        count,
        took_client_ms: took,
        took_server_ms: result.took_ms,
        results: result.results || [],
        ok: result.ok,
        raw: result,
      });

      if (hasResults) {
        passed++;
        // Show top 3 results
        const top3 = (result.results || []).slice(0, 3);
        top3.forEach((r, i) => {
          const placeholder = r.is_placeholder ? ' [placeholder]' : '';
          console.log(`  ${i + 1}. ${r.product_name} (${r.product_brand}) - score: ${r.score.toFixed(4)}${placeholder}`);
        });
      } else {
        failed++;
        console.log(`  ⚠️  No results returned`);
      }
    } catch (err) {
      console.log(`✗ ERROR: ${err.message}`);
      results.push({
        query,
        k,
        description,
        error: err.message,
        ok: false,
      });
      failed++;
    }
    console.log('');
  }

  const summary = {
    timestamp: new Date().toISOString(),
    endpoint: SEARCH_URL,
    total_queries: SMOKE_QUERIES.length,
    passed,
    failed,
    success_rate: ((passed / SMOKE_QUERIES.length) * 100).toFixed(1) + '%',
  };

  const output = {
    summary,
    results,
  };

  const filename = 'smoke-test-v3-results.json';
  writeFileSync(filename, JSON.stringify(output, null, 2));

  console.log('📊 Summary:');
  console.log(`  Total queries: ${summary.total_queries}`);
  console.log(`  Passed: ${passed} ✓`);
  console.log(`  Failed: ${failed} ✗`);
  console.log(`  Success rate: ${summary.success_rate}`);
  console.log(`\n💾 Results saved to: ${filename}`);

  return failed === 0 ? 0 : 1;
}

runSmokeTests()
  .then(code => process.exit(code))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
