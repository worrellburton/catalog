#!/usr/bin/env node

/**
 * Search V3 Smoke Tests - Active Products (34 products)
 * 
 * Tests search queries against the actual 34 active products in the catalog.
 * Queries are tailored to match what we actually have in stock.
 */

import 'dotenv/config';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('❌ Missing environment variables');
  console.error('Required: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY');
  process.exit(1);
}

const SEARCH_ENDPOINT = `${SUPABASE_URL}/functions/v1/search`;

// Test queries based on actual active products
const TEST_QUERIES = [
  // Products that exist (should return results)
  { query: 'tennis dress', description: 'Specific product (Breezy Tennis Dress)', expectedMin: 1 },
  { query: 'breezy tennis dress black', description: 'Exact product match', expectedMin: 1 },
  { query: 'black patent leather shoe', description: 'Multi-word specific search', expectedMin: 1 },
  { query: 'alo yoga shorts', description: 'Brand + category search', expectedMin: 3 },
  { query: 'game time short', description: 'Exact product name', expectedMin: 1 },
  { query: 'james perse pants', description: 'Brand + category', expectedMin: 2 },
  { query: 'rag and bone jeans', description: 'Brand + type', expectedMin: 2 },
  { query: 'cashmere beanie', description: 'Material + type', expectedMin: 1 },
  { query: 'velvet cap', description: 'Material + accessory', expectedMin: 1 },
  { query: 'tennis skirt', description: 'Sport specific', expectedMin: 1 },
  { query: 'ribbed tank', description: 'Style + type', expectedMin: 1 },
  { query: 'crewneck sweater', description: 'Style + garment', expectedMin: 1 },
  { query: 'sports bra', description: 'Underwear category', expectedMin: 1 },
  { query: 'houseplant', description: 'Decor item', expectedMin: 1 },
  { query: 'fiddle leaf fig', description: 'Specific plant', expectedMin: 1 },
  
  // Generic queries (may or may not return results with strict matching)
  { query: 'dress', description: 'Generic category', expectedMin: 0 },
  { query: 'shorts', description: 'Generic category', expectedMin: 0 },
  { query: 'pants', description: 'Generic category', expectedMin: 0 },
  { query: 'top', description: 'Generic category', expectedMin: 0 },
  { query: 'hat', description: 'Generic accessory', expectedMin: 0 },
  
  // Products that don't exist (should return 0 results)
  { query: 'sunglasses', description: 'Non-existent product', expectedMin: 0, expectedMax: 0 },
  { query: 'sneakers', description: 'Non-existent footwear', expectedMin: 0, expectedMax: 0 },
  { query: 'jacket', description: 'Non-existent outerwear', expectedMin: 0, expectedMax: 0 },
  { query: 'handbag', description: 'Non-existent accessory', expectedMin: 0, expectedMax: 0 },
];

async function search(query, k = 10) {
  const start = Date.now();
  
  const response = await fetch(SEARCH_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify({ query, k }),
  });

  const clientTook = Date.now() - start;

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  return {
    ...data,
    client_took_ms: clientTook,
  };
}

function formatResult(result, index) {
  const emoji = result.is_placeholder ? '📦' : '🎬';
  return `  ${index + 1}. ${emoji} ${result.product_name} (${result.product_brand}) - score: ${result.score.toFixed(4)}${result.is_placeholder ? ' [placeholder]' : ''}`;
}

async function runTests() {
  console.log('🔍 Search V3 Active Products Smoke Tests\n');
  console.log(`Endpoint: ${SEARCH_ENDPOINT}`);
  console.log(`Queries: ${TEST_QUERIES.length}\n`);

  const results = {};
  let passed = 0;
  let failed = 0;

  for (const test of TEST_QUERIES) {
    const { query, description, expectedMin = 0, expectedMax } = test;
    process.stdout.write(`Testing: "${query}" (${description})... `);

    try {
      const result = await search(query);
      const count = result.results?.length || 0;
      const serverTook = result.took_ms || 0;
      const clientTook = result.client_took_ms || 0;

      // Check if result meets expectations
      let testPassed = count >= expectedMin;
      if (expectedMax !== undefined) {
        testPassed = testPassed && count <= expectedMax;
      }

      if (testPassed) {
        console.log(`✓ ${count} results (${clientTook}ms, ${serverTook}ms server)`);
        passed++;
      } else {
        console.log(`✗ ${count} results - expected ${expectedMax !== undefined ? `${expectedMin}-${expectedMax}` : `${expectedMin}+`} (${clientTook}ms, ${serverTook}ms server)`);
        failed++;
      }

      // Show top 3 results
      if (count > 0) {
        result.results.slice(0, 3).forEach((r, i) => {
          console.log(formatResult(r, i));
        });
      } else {
        console.log('  ⚠️  No results returned');
      }

      results[query] = {
        description,
        count,
        took_ms: serverTook,
        client_took_ms: clientTook,
        passed: testPassed,
        expected_min: expectedMin,
        expected_max: expectedMax,
        results: result.results || [],
      };

      console.log(''); // blank line between tests
    } catch (error) {
      console.log(`✗ Error: ${error.message}`);
      failed++;
      results[query] = {
        description,
        error: error.message,
        passed: false,
      };
      console.log('');
    }
  }

  console.log('📊 Summary:');
  console.log(`  Total queries: ${TEST_QUERIES.length}`);
  console.log(`  Passed: ${passed} ✓`);
  console.log(`  Failed: ${failed} ✗`);
  console.log(`  Success rate: ${((passed / TEST_QUERIES.length) * 100).toFixed(1)}%`);

  // Save results
  const outputFile = 'smoke-test-active-products-results.json';
  const fs = await import('fs/promises');
  await fs.writeFile(
    outputFile,
    JSON.stringify(results, null, 2),
    'utf-8'
  );
  console.log(`\n💾 Results saved to: ${outputFile}`);

  // Exit with error code if any tests failed
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
