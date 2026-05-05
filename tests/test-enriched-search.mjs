#!/usr/bin/env node
/**
 * Test contextual search on the 3 enriched products
 * Verify that enrichment enables contextual queries to work
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://vtarjrnqvcqbhoclvcur.supabase.co';
const ANON_KEY = process.env.ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

if (!ANON_KEY) {
  console.error('❌ Missing ANON_KEY env var');
  process.exit(1);
}

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

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Search failed: ${res.status} ${text}`);
  }

  return await res.json();
}

// Test queries targeting the enriched content
const tests = [
  {
    query: 'gym workout',
    expected: 'Game Time Short',
    reason: 'Enriched description mentions "gym workouts"',
  },
  {
    query: 'yoga',
    expected: 'Game Time Short',
    reason: 'Enriched description mentions "yoga sessions"',
  },
  {
    query: 'shorts under 80',
    expected: 'Game Time Short',
    reason: 'Enriched description mentions "At $78"',
  },
  {
    query: 'casual friday',
    expected: ['Logan Wide-Leg Jeans', 'Classic Denim Pant'],
    reason: 'Enriched descriptions mention "casual Friday"',
  },
  {
    query: 'brunch',
    expected: ['Logan Wide-Leg Jeans', 'Classic Denim Pant'],
    reason: 'Enriched descriptions mention "brunch"',
  },
  {
    query: 'weekend',
    expected: ['Game Time Short', 'Logan Wide-Leg Jeans', 'Classic Denim Pant'],
    reason: 'All 3 enriched descriptions mention "weekend"',
  },
];

async function runTests() {
  console.log('🧪 Testing Contextual Search on 3 Enriched Products\n');
  console.log('='.repeat(80));

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    console.log(`\n📝 Query: "${test.query}"`);
    console.log(`   Expected: ${Array.isArray(test.expected) ? test.expected.join(' OR ') : test.expected}`);
    console.log(`   Reason: ${test.reason}`);

    try {
      const { results, took_ms } = await search(test.query, 10);
      
      console.log(`   ⏱️  Took: ${took_ms}ms`);
      console.log(`   📊 Results: ${results.length} products found`);

      if (results.length === 0) {
        console.log(`   ❌ FAIL - No results (enrichment may not have worked)`);
        failed++;
        continue;
      }

      // Check if expected product(s) are in results
      const productNames = results.map(r => r.product_name);
      const expectedArray = Array.isArray(test.expected) ? test.expected : [test.expected];
      const foundExpected = expectedArray.some(exp => 
        productNames.some(name => name && name.includes(exp))
      );

      if (foundExpected) {
        console.log(`   ✅ PASS - Found expected product(s)`);
        console.log(`   Top results:`);
        results.slice(0, 3).forEach((r, i) => {
          const isExpected = expectedArray.some(exp => r.product_name && r.product_name.includes(exp));
          console.log(`     ${i + 1}. ${r.product_name || 'Unknown'} ${isExpected ? '⭐' : ''}`);
          console.log(`        Score: ${r.score?.toFixed(4)}`);
        });
        passed++;
      } else {
        console.log(`   ❌ FAIL - Expected product not found`);
        console.log(`   Got: ${productNames.slice(0, 3).join(', ')}`);
        failed++;
      }

    } catch (err) {
      console.log(`   ❌ ERROR: ${err.message}`);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`\n📊 Results Summary:`);
  console.log(`   ✅ Passed: ${passed}/${tests.length} (${((passed/tests.length)*100).toFixed(1)}%)`);
  console.log(`   ❌ Failed: ${failed}/${tests.length} (${((failed/tests.length)*100).toFixed(1)}%)`);

  if (passed === tests.length) {
    console.log('\n🎉 Perfect! All contextual queries work with enriched descriptions!');
    console.log('   Ready to proceed with full backfill of 793 products.');
  } else if (passed > 0) {
    console.log('\n👍 Partial success! Some contextual queries work.');
    console.log('   May need to tune enrichment prompt or threshold.');
  } else {
    console.log('\n⚠️  No queries worked. Check:');
    console.log('   1. Descriptions were actually updated in DB');
    console.log('   2. Products were re-embedded');
    console.log('   3. Embedding picked up new content');
  }
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
