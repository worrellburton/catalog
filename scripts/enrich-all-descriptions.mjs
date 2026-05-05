#!/usr/bin/env node
/**
 * Full backfill: Enrich all product descriptions with AI-generated contextual content
 * 
 * Adds occasion/activity/price context to product descriptions to enable
 * contextual search queries like "casual friday", "gym workout", "brunch", etc.
 * 
 * Cost: ~$4 for 793 products (~$0.005 per product via Claude API)
 * Time: ~30-40 minutes with rate limiting
 * 
 * Usage:
 *   set -a && source .env && set +a && node scripts/enrich-all-descriptions.mjs
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://vtarjrnqvcqbhoclvcur.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!ANTHROPIC_API_KEY) {
  console.error('❌ Missing ANTHROPIC_API_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// Rate limiting
const BATCH_SIZE = 10; // Process 10 products at a time
const DELAY_BETWEEN_BATCHES = 2000; // 2 seconds between batches
const DELAY_BETWEEN_CALLS = 500; // 500ms between individual API calls

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function enrichDescription(product) {
  const { name, brand, type, price, gender, description } = product;
  
  const prompt = `You are a fashion copywriter. Enhance this product description by adding 2-3 sentences with:
- Specific occasions (e.g., "casual friday", "weekend brunch", "date night", "yoga class")
- Activities it's perfect for (e.g., "gym workouts", "running errands", "lounging")
- Price context using the actual price (e.g., "at $78", "under $300", "luxury $550")
- Keep it natural and conversational

Product: ${name}
Brand: ${brand || 'Unknown'}
Type: ${type || 'Unknown'}
Gender: ${gender || 'unisex'}
Price: ${price || 'Unknown'}

Current description:
${description || 'No description available.'}

IMPORTANT:
- Keep existing description text
- Add new sentences at the END
- Be specific about occasions and activities
- Mention the actual price if available
- Keep total length under 500 characters
- Use natural, flowing language

Return ONLY the enhanced description, nothing else.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const enrichedDescription = response.content[0].text.trim();
    return enrichedDescription;
  } catch (err) {
    console.error(`   ❌ Claude API error for ${name}:`, err.message);
    return null;
  }
}

async function updateProductDescription(productId, enrichedDescription) {
  try {
    const { error } = await supabase
      .from('products')
      .update({ 
        description: enrichedDescription,
        description_enriched: true // Flag to track enrichment status
      })
      .eq('id', productId);

    if (error) {
      console.error(`   ❌ DB update error:`, error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`   ❌ DB update exception:`, err.message);
    return false;
  }
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
        id: productId, // Edge function expects 'id' not 'product_id'
        force: true // Force re-embedding even if embedding exists
      })
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`   ⚠️  Re-embed warning:`, text.substring(0, 100));
      return false;
    }
    return true;
  } catch (err) {
    console.error(`   ⚠️  Re-embed error:`, err.message);
    return false;
  }
}

async function getAllProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, brand, type, price, gender, description, description_enriched')
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch products: ${error.message}`);
  }

  return data;
}

async function runBackfill() {
  console.log('🚀 AI Description Enrichment - Full Backfill\n');
  console.log('='.repeat(80));
  
  // Fetch all products
  console.log('\n📊 Fetching products...');
  const allProducts = await getAllProducts();
  console.log(`   Total products: ${allProducts.length}`);

  // Filter products that need enrichment
  const productsToEnrich = allProducts.filter(p => !p.description_enriched);
  console.log(`   Already enriched: ${allProducts.length - productsToEnrich.length}`);
  console.log(`   Need enrichment: ${productsToEnrich.length}`);

  if (productsToEnrich.length === 0) {
    console.log('\n✅ All products already enriched!');
    return;
  }

  // Estimate cost and time
  const estimatedCost = (productsToEnrich.length * 0.005).toFixed(2);
  const estimatedMinutes = Math.ceil((productsToEnrich.length / BATCH_SIZE) * (DELAY_BETWEEN_BATCHES / 1000) / 60);
  
  console.log(`\n💰 Estimated cost: $${estimatedCost}`);
  console.log(`⏱️  Estimated time: ${estimatedMinutes}-${estimatedMinutes + 10} minutes`);
  console.log(`📦 Batch size: ${BATCH_SIZE} products`);
  console.log(`⏸️  Delay: ${DELAY_BETWEEN_BATCHES}ms between batches, ${DELAY_BETWEEN_CALLS}ms between calls`);
  
  console.log('\n' + '='.repeat(80));
  console.log('Starting enrichment process...\n');

  let enriched = 0;
  let failed = 0;
  let skipped = 0;
  const startTime = Date.now();

  // Process in batches
  for (let i = 0; i < productsToEnrich.length; i += BATCH_SIZE) {
    const batch = productsToEnrich.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(productsToEnrich.length / BATCH_SIZE);
    
    console.log(`\n📦 Batch ${batchNum}/${totalBatches} (${batch.length} products)`);
    console.log('─'.repeat(80));

    for (const product of batch) {
      const num = i + batch.indexOf(product) + 1;
      console.log(`\n${num}/${productsToEnrich.length}. ${product.name}`);
      console.log(`   Brand: ${product.brand || 'Unknown'}`);
      console.log(`   Type: ${product.type || 'Unknown'}`);
      console.log(`   Price: ${product.price || 'Unknown'}`);
      console.log(`   Current length: ${product.description?.length || 0} chars`);

      // Skip if no description
      if (!product.description || product.description.length < 20) {
        console.log(`   ⚠️  SKIPPED - No meaningful description to enrich`);
        skipped++;
        continue;
      }

      // Enrich description
      const enrichedDescription = await enrichDescription(product);
      
      if (!enrichedDescription) {
        console.log(`   ❌ FAILED - Could not generate enrichment`);
        failed++;
        await sleep(DELAY_BETWEEN_CALLS);
        continue;
      }

      console.log(`   New length: ${enrichedDescription.length} chars (+${enrichedDescription.length - product.description.length})`);

      // Update database
      const updated = await updateProductDescription(product.id, enrichedDescription);
      if (!updated) {
        console.log(`   ❌ FAILED - Could not update database`);
        failed++;
        await sleep(DELAY_BETWEEN_CALLS);
        continue;
      }

      console.log(`   ✅ Description updated`);

      // Trigger re-embedding
      const reembedded = await triggerReembed(product.id);
      if (reembedded) {
        console.log(`   🧠 Re-embedded`);
      } else {
        console.log(`   ⚠️  Re-embed failed (will retry later)`);
      }

      enriched++;

      // Rate limiting between individual calls
      await sleep(DELAY_BETWEEN_CALLS);
    }

    // Rate limiting between batches
    if (i + BATCH_SIZE < productsToEnrich.length) {
      const remaining = productsToEnrich.length - (i + BATCH_SIZE);
      const progress = ((i + BATCH_SIZE) / productsToEnrich.length * 100).toFixed(1);
      console.log(`\n⏸️  Batch complete. Progress: ${progress}% (${remaining} remaining)`);
      console.log(`   Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch...`);
      await sleep(DELAY_BETWEEN_BATCHES);
    }
  }

  const elapsed = Date.now() - startTime;
  const minutes = Math.floor(elapsed / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);

  console.log('\n' + '='.repeat(80));
  console.log('\n🎉 Backfill Complete!\n');
  console.log(`⏱️  Time elapsed: ${minutes}m ${seconds}s`);
  console.log(`✅ Enriched: ${enriched}`);
  console.log(`⚠️  Skipped: ${skipped} (no description)`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Success rate: ${((enriched / (enriched + failed)) * 100).toFixed(1)}%`);

  if (failed > 0) {
    console.log(`\n⚠️  ${failed} products failed. You can re-run this script to retry.`);
  }

  console.log('\n💡 Next steps:');
  console.log('   1. Run contextual search tests: node tests/test-contextual-search.mjs');
  console.log('   2. Run smoke tests: node tests/search/run-golden.mjs');
  console.log('   3. Validate improvement in contextual queries');
}

// Run backfill
runBackfill().catch(err => {
  console.error('\n💥 Fatal error:', err);
  process.exit(1);
});
