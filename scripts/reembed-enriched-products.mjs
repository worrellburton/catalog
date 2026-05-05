#!/usr/bin/env node
/**
 * Re-embed all enriched products
 * 
 * Run this after the enrichment backfill to ensure all enriched products
 * get re-embedded with their new contextual descriptions.
 * 
 * Usage:
 *   set -a && source .env && set +a && node scripts/reembed-enriched-products.mjs
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://vtarjrnqvcqbhoclvcur.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const BATCH_SIZE = 20;
const DELAY_BETWEEN_CALLS = 300; // 300ms between calls

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function triggerReembed(productId) {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/embed-product`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({
        id: productId,
        force: true
      })
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: text.substring(0, 100) };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function getEnrichedProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('id, name')
    .eq('description_enriched', true)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch products: ${error.message}`);
  }

  return data;
}

async function runReembedding() {
  console.log('🧠 Re-embed Enriched Products\n');
  console.log('='.repeat(80));
  
  console.log('\n📊 Fetching enriched products...');
  const products = await getEnrichedProducts();
  console.log(`   Total enriched products: ${products.length}`);

  console.log(`\n⏱️  Estimated time: ${Math.ceil(products.length * DELAY_BETWEEN_CALLS / 1000 / 60)} minutes`);
  console.log('='.repeat(80));
  console.log('Starting re-embedding...\n');

  let succeeded = 0;
  let failed = 0;
  const startTime = Date.now();

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const num = i + 1;
    
    process.stdout.write(`${num}/${products.length}. ${product.name}... `);

    const result = await triggerReembed(product.id);
    
    if (result.success) {
      console.log('✅');
      succeeded++;
    } else {
      console.log(`❌ ${result.error}`);
      failed++;
    }

    // Progress update every batch
    if (num % BATCH_SIZE === 0) {
      const progress = (num / products.length * 100).toFixed(1);
      const elapsed = Date.now() - startTime;
      const rate = num / (elapsed / 1000);
      const remaining = Math.ceil((products.length - num) / rate);
      console.log(`   Progress: ${progress}% | ${succeeded} succeeded, ${failed} failed | ~${remaining}s remaining`);
    }

    await sleep(DELAY_BETWEEN_CALLS);
  }

  const elapsed = Date.now() - startTime;
  const minutes = Math.floor(elapsed / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);

  console.log('\n' + '='.repeat(80));
  console.log('\n✅ Re-embedding Complete!\n');
  console.log(`⏱️  Time: ${minutes}m ${seconds}s`);
  console.log(`✅ Succeeded: ${succeeded}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Success rate: ${((succeeded / products.length) * 100).toFixed(1)}%`);
}

runReembedding().catch(err => {
  console.error('\n💥 Fatal error:', err);
  process.exit(1);
});
