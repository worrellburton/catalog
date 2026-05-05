#!/usr/bin/env node
/**
 * Update 3 test products with enriched descriptions and re-embed them
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Missing SUPABASE env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// Enriched descriptions from our test
const enrichedProducts = [
  {
    name: 'Game Time Short - Black',
    enrichedDescription: "High-rise elastic waistband shorts with breezy fit and built-in shorts for coverage. Features subtle Alo branding. Perfect for yoga sessions, casual weekend outings, or lounging at home with their comfortable athletic style. The versatile design transitions seamlessly from gym workouts to running errands around town. At $78, these shorts offer premium activewear quality without breaking the bank."
  },
  {
    name: 'Logan Wide-Leg Jeans - Wellbrook',
    enrichedDescription: "Wide-leg silhouette crafted from premium denim with a high-rise waist and relaxed fit through the leg. Perfect for elevated casual occasions like weekend brunch, coffee dates, or casual Friday at the office. The relaxed wide-leg style works beautifully for leisurely strolling, shopping trips, or any activity where comfort meets chic. At under $300, these premium denim jeans offer that coveted rag & bone quality for your elevated casual wardrobe."
  },
  {
    name: 'Classic Denim Pant - Medium Wash',
    enrichedDescription: "Timeless five-pocket jeans in a straight-leg cut with classic medium wash. Premium Japanese denim. Perfect for casual Fridays at the office or weekend outings with friends. The versatile straight-leg silhouette works equally well for grabbing brunch or exploring the city. Luxury pricing at $550 reflects the premium Japanese denim and refined craftsmanship."
  }
];

async function updateAndReembed() {
  console.log('🔧 Updating 3 test products with enriched descriptions...\n');

  for (const product of enrichedProducts) {
    // Find the product by name
    const { data: found, error: findError } = await supabase
      .from('products')
      .select('id, name, description')
      .eq('name', product.name)
      .single();

    if (findError || !found) {
      console.log(`⚠️  Product not found: ${product.name}`);
      continue;
    }

    console.log(`📝 ${found.name}`);
    console.log(`   ID: ${found.id}`);
    console.log(`   Old description length: ${(found.description || '').length} chars`);
    console.log(`   New description length: ${product.enrichedDescription.length} chars`);

    // Update the description
    const { error: updateError } = await supabase
      .from('products')
      .update({ description: product.enrichedDescription })
      .eq('id', found.id);

    if (updateError) {
      console.log(`   ❌ Update failed: ${updateError.message}`);
      continue;
    }

    console.log(`   ✅ Description updated`);

    // Trigger re-embedding via edge function
    const embedUrl = `${SUPABASE_URL}/functions/v1/embed-product`;
    const embedRes = await fetch(embedUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
      },
      body: JSON.stringify({ id: found.id, force: true }),
    });

    if (!embedRes.ok) {
      const text = await embedRes.text();
      console.log(`   ⚠️  Re-embedding failed: ${embedRes.status} ${text}`);
    } else {
      const embedData = await embedRes.json();
      console.log(`   🧠 Re-embedded (took ${embedData.took_ms || '?'}ms)`);
    }

    console.log('');
  }

  console.log('✅ All 3 products updated and re-embedded!\n');
  console.log('💡 Next: Run contextual search tests to verify improvement');
  console.log('   node tests/test-enriched-search.mjs');
}

updateAndReembed().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
