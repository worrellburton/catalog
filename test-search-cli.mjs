#!/usr/bin/env node
/**
 * CLI tool for testing search with keywords and saving results to JSON
 * 
 * Usage:
 *   node test-search-cli.mjs "black dress" --output results.json
 *   node test-search-cli.mjs "yoga" -o yoga-results.json
 *   node test-search-cli.mjs "casual friday" --k 20 --gender female
 */

import { writeFileSync } from 'fs';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://vtarjrnqvcqbhoclvcur.supabase.co';
const ANON_KEY = process.env.ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

if (!ANON_KEY) {
  console.error('❌ Missing ANON_KEY env var');
  console.error('Run: set -a && source .env && set +a && node test-search-cli.mjs "keyword"');
  process.exit(1);
}

// Parse CLI arguments
const args = process.argv.slice(2);
if (args.length === 0 || args[0].startsWith('-')) {
  console.log(`
Usage: node test-search-cli.mjs <keyword> [options]

Arguments:
  <keyword>          Search query (required)

Options:
  -o, --output FILE  Save results to JSON file (default: search-results.json)
  -k NUMBER          Number of results to fetch (default: 24)
  --gender TEXT      Filter by gender (male/female/unisex)
  --verbose          Show detailed output

Examples:
  node test-search-cli.mjs "black dress"
  node test-search-cli.mjs "yoga shorts" --output yoga.json
  node test-search-cli.mjs "casual friday" --k 20 --gender female
  node test-search-cli.mjs "gym workout" --verbose
  `);
  process.exit(1);
}

const keyword = args[0];
let outputFile = 'search-results.json';
let k = 24;
let gender = null;
let verbose = false;

// Parse options
for (let i = 1; i < args.length; i++) {
  const arg = args[i];
  switch (arg) {
    case '-o':
    case '--output':
      outputFile = args[++i];
      break;
    case '-k':
      k = parseInt(args[++i], 10);
      break;
    case '--gender':
      gender = args[++i];
      break;
    case '--verbose':
      verbose = true;
      break;
  }
}

async function search(query, k, gender) {
  const url = `${SUPABASE_URL}/functions/v1/search`;
  const body = { query, k };
  if (gender) body.gender = gender;

  const res = await fetch(url, {
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
    throw new Error(`Search failed: ${res.status} ${text}`);
  }

  return await res.json();
}

async function runTest() {
  console.log('🔍 Search Test CLI\n');
  console.log(`Query: "${keyword}"`);
  console.log(`Results: ${k}`);
  if (gender) console.log(`Gender filter: ${gender}`);
  console.log('─'.repeat(80));

  const startTime = Date.now();
  
  try {
    const response = await search(keyword, k, gender);
    const elapsed = Date.now() - startTime;

    const { results, count, took_ms } = response;
    
    console.log(`\n✅ Search completed`);
    console.log(`   Server time: ${took_ms}ms`);
    console.log(`   Total time: ${elapsed}ms`);
    console.log(`   Results: ${results.length} products`);

    if (verbose && results.length > 0) {
      console.log('\n📊 Top Results:');
      results.slice(0, 10).forEach((r, i) => {
        console.log(`\n${i + 1}. ${r.product_name || 'Unknown'}`);
        console.log(`   Brand: ${r.product_brand || 'N/A'}`);
        console.log(`   Price: ${r.product_price || 'N/A'}`);
        console.log(`   Type: ${r.product_type || 'N/A'}`);
        console.log(`   Gender: ${r.product_gender || 'N/A'}`);
        console.log(`   Score: ${r.score?.toFixed(4) || 'N/A'}`);
        console.log(`   Has video: ${r.video_url ? '✅' : '❌'}`);
      });
    } else if (results.length > 0) {
      console.log('\n📊 Top 5 Results:');
      results.slice(0, 5).forEach((r, i) => {
        console.log(`   ${i + 1}. ${r.product_name || 'Unknown'} (${r.score?.toFixed(4)})`);
      });
    }

    // Prepare output data
    const output = {
      meta: {
        query: keyword,
        timestamp: new Date().toISOString(),
        k,
        gender,
        elapsed_ms: elapsed,
        server_ms: took_ms,
        result_count: results.length,
      },
      results: results.map(r => ({
        product_id: r.product_id,
        product_name: r.product_name,
        product_brand: r.product_brand,
        product_price: r.product_price,
        product_type: r.product_type,
        product_gender: r.product_gender,
        product_url: r.product_url,
        product_image_url: r.product_image_url,
        score: r.score,
        has_video: !!r.video_url,
        creative_id: r.creative_id,
        video_url: r.video_url,
        thumbnail_url: r.thumbnail_url,
        is_elite: r.is_elite,
      })),
    };

    // Save to JSON
    writeFileSync(outputFile, JSON.stringify(output, null, 2));
    console.log(`\n💾 Saved to ${outputFile}`);

    // Summary stats
    const withVideo = results.filter(r => r.video_url).length;
    const avgScore = results.length > 0 
      ? (results.reduce((sum, r) => sum + (r.score || 0), 0) / results.length)
      : 0;

    console.log('\n📈 Summary:');
    console.log(`   Total results: ${results.length}`);
    console.log(`   With video: ${withVideo} (${((withVideo/results.length)*100).toFixed(1)}%)`);
    console.log(`   Avg score: ${avgScore.toFixed(4)}`);
    console.log(`   Score range: ${results[0]?.score?.toFixed(4) || 'N/A'} - ${results[results.length-1]?.score?.toFixed(4) || 'N/A'}`);

    // Brand distribution
    const brands = {};
    results.forEach(r => {
      const brand = r.product_brand || 'Unknown';
      brands[brand] = (brands[brand] || 0) + 1;
    });
    const topBrands = Object.entries(brands)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    if (topBrands.length > 0) {
      console.log('\n🏷️  Top Brands:');
      topBrands.forEach(([brand, count]) => {
        console.log(`   ${brand}: ${count} products`);
      });
    }

    // Type distribution
    const types = {};
    results.forEach(r => {
      const type = r.product_type || 'Unknown';
      types[type] = (types[type] || 0) + 1;
    });
    const topTypes = Object.entries(types)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    if (topTypes.length > 0) {
      console.log('\n👕 Top Types:');
      topTypes.forEach(([type, count]) => {
        console.log(`   ${type}: ${count} products`);
      });
    }

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    
    // Save error to JSON anyway
    const errorOutput = {
      meta: {
        query: keyword,
        timestamp: new Date().toISOString(),
        k,
        gender,
        error: err.message,
      },
      results: [],
    };
    writeFileSync(outputFile, JSON.stringify(errorOutput, null, 2));
    console.log(`\n💾 Error saved to ${outputFile}`);
    
    process.exit(1);
  }
}

runTest().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
