#!/usr/bin/env node
/**
 * Test contextual and constraint-based queries
 * Tests: price filters, occasions, styling contexts
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

const contextualTests = [
  {
    query: 'shorts under 80',
    description: 'Price constraint query',
    expectation: 'Should find shorts priced under $80',
  },
  {
    query: 'shorts under $80',
    description: 'Price constraint with $ symbol',
    expectation: 'Should find shorts priced under $80',
  },
  {
    query: 'beach party',
    description: 'Occasion-based query',
    expectation: 'Should find beachwear, swimwear, casual summer items',
  },
  {
    query: 'date night',
    description: 'Occasion-based query',
    expectation: 'Should find elegant/dressy items',
  },
  {
    query: 'gym workout',
    description: 'Activity-based query',
    expectation: 'Should find activewear, athletic clothing',
  },
  {
    query: 'casual friday',
    description: 'Context-based query',
    expectation: 'Should find business casual items',
  },
  {
    query: 'summer vacation',
    description: 'Context-based query',
    expectation: 'Should find light, casual, vacation-appropriate items',
  },
];

async function runTests() {
  console.log('🔍 Testing Contextual & Constraint-Based Search\n');
  console.log('='.repeat(80));

  let totalTests = 0;
  let canHandle = 0;
  let cannotHandle = 0;

  for (const test of contextualTests) {
    totalTests++;
    console.log(`\n📝 Query: "${test.query}"`);
    console.log(`   Description: ${test.description}`);
    console.log(`   Expected: ${test.expectation}`);

    try {
      const { results, took_ms } = await search(test.query, 10);
      
      console.log(`   ⏱️  Took: ${took_ms}ms`);
      console.log(`   📊 Results: ${results.length} products found`);

      if (results.length === 0) {
        console.log(`   ⚠️  No results - Search cannot handle this query type`);
        cannotHandle++;
        continue;
      }

      // Show top 3 results
      console.log(`   Top 3 matches:`);
      results.slice(0, 3).forEach((r, i) => {
        console.log(`     ${i + 1}. ${r.product_name || 'Unknown'}`);
        console.log(`        Brand: ${r.product_brand || 'N/A'} | Type: ${r.product_type || 'N/A'} | Price: ${r.product_price || 'N/A'}`);
        console.log(`        Score: ${r.score?.toFixed(4) || 'N/A'}`);
      });

      // Analyze if results make sense for the query
      const analysis = analyzeResults(test.query, results);
      if (analysis.relevant) {
        console.log(`   ✅ Results appear relevant`);
        canHandle++;
      } else {
        console.log(`   ⚠️  Results may not match query intent: ${analysis.reason}`);
        cannotHandle++;
      }

    } catch (err) {
      console.log(`   ❌ Error: ${err.message}`);
      cannotHandle++;
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`\n📊 Summary:`);
  console.log(`   Total tests: ${totalTests}`);
  console.log(`   Can handle: ${canHandle} (${((canHandle/totalTests)*100).toFixed(1)}%)`);
  console.log(`   Cannot handle: ${cannotHandle} (${((cannotHandle/totalTests)*100).toFixed(1)}%)`);
  console.log('\n💡 Note: Current search is semantic text-based. Advanced features needed:');
  console.log('   - Price filtering: requires SQL WHERE price < $80');
  console.log('   - Occasion/context: may work via semantic similarity to descriptions');
  console.log('   - Activity/styling: depends on product descriptions mentioning these contexts');
}

function analyzeResults(query, results) {
  const lowerQuery = query.toLowerCase();

  // Price constraint check
  if (lowerQuery.includes('under') && /\d+/.test(lowerQuery)) {
    const priceLimit = parseInt(lowerQuery.match(/\d+/)[0]);
    const prices = results.map(r => {
      const priceStr = (r.product_price || '').replace(/[^0-9.]/g, '');
      return parseFloat(priceStr) || 999999;
    });
    const allUnderLimit = prices.every(p => p <= priceLimit);
    
    if (!allUnderLimit) {
      const overLimit = prices.filter(p => p > priceLimit).length;
      return {
        relevant: false,
        reason: `${overLimit}/${results.length} products are over $${priceLimit}`,
      };
    }
  }

  // Occasion-based check (basic heuristic)
  if (lowerQuery.includes('beach') || lowerQuery.includes('party')) {
    const types = results.map(r => (r.product_type || '').toLowerCase());
    const hasRelevantTypes = types.some(t => 
      t.includes('swim') || t.includes('short') || t.includes('dress') || 
      t.includes('sandal') || t.includes('top')
    );
    if (!hasRelevantTypes) {
      return {
        relevant: false,
        reason: 'No beachwear/party-appropriate types found',
      };
    }
  }

  if (lowerQuery.includes('date night')) {
    const types = results.map(r => (r.product_type || '').toLowerCase());
    const hasRelevantTypes = types.some(t => 
      t.includes('dress') || t.includes('pant') || t.includes('shirt') || 
      t.includes('top') || t.includes('jacket')
    );
    if (!hasRelevantTypes) {
      return {
        relevant: false,
        reason: 'No date-night appropriate types found',
      };
    }
  }

  if (lowerQuery.includes('gym') || lowerQuery.includes('workout')) {
    const types = results.map(r => (r.product_type || '').toLowerCase());
    const descriptions = results.map(r => (r.description || '').toLowerCase());
    const hasActivewear = types.some(t => 
      t.includes('active') || t.includes('short') || t.includes('legging') || 
      t.includes('top') || t.includes('bra')
    ) || descriptions.some(d => 
      d.includes('workout') || d.includes('athletic') || d.includes('gym') ||
      d.includes('performance') || d.includes('sport')
    );
    if (!hasActivewear) {
      return {
        relevant: false,
        reason: 'No activewear/workout items found',
      };
    }
  }

  return { relevant: true };
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
