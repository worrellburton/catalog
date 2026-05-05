#!/usr/bin/env node
/**
 * Proof of concept: Enrich product descriptions with AI-generated context
 * Test on 3 sample products to validate the approach
 */

import Anthropic from '@anthropic-ai/sdk';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  console.error('❌ Missing ANTHROPIC_API_KEY env var');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// Sample products from our catalog
const sampleProducts = [
  {
    name: 'Game Time Short - Black',
    brand: 'Alo Yoga',
    type: 'Shorts',
    gender: 'female',
    price: '$78',
    description: 'High-rise elastic waistband shorts with breezy fit and built-in shorts for coverage. Features subtle Alo branding.',
  },
  {
    name: 'Logan Wide-Leg Jeans - Wellbrook',
    brand: 'rag & bone',
    type: 'Pants',
    gender: 'female',
    price: '$278.00',
    description: 'Wide-leg silhouette crafted from premium denim with a high-rise waist and relaxed fit through the leg.',
  },
  {
    name: 'Classic Denim Pant - Medium Wash',
    brand: 'James Perse',
    type: 'Pants',
    gender: 'male',
    price: '$550.00',
    description: 'Timeless five-pocket jeans in a straight-leg cut with classic medium wash. Premium Japanese denim.',
  },
];

async function enrichDescription(product) {
  const prompt = `Given this fashion product:

Name: ${product.name}
Brand: ${product.brand}
Type: ${product.type}
Gender: ${product.gender}
Price: ${product.price}
Current description: ${product.description}

Add 2-3 SHORT, natural sentences that include:
1. Ideal occasions (e.g., beach party, date night, casual friday, gym workout, brunch, travel)
2. Activities it suits (e.g., running, yoga, lounging, working out, going out)
3. Price context using natural phrases (e.g., "under $100", "under $300", "luxury pricing at $X", "affordable at $X")
4. Style context (e.g., casual, athletic, dressy, business-casual, weekend wear, evening)

Be specific and natural. Match the brand's vibe. Return ONLY the 2-3 additional sentences to append.`;

  console.log(`\n🤖 Enriching: ${product.name}...`);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 250,
    messages: [{ role: 'user', content: prompt }],
  });

  const enrichment = response.content[0].text.trim();
  const enrichedDescription = `${product.description} ${enrichment}`;

  return { enrichment, enrichedDescription };
}

async function runTest() {
  console.log('🔬 Description Enrichment Proof of Concept\n');
  console.log('Testing on 3 sample products from our catalog...\n');
  console.log('='.repeat(80));

  for (const product of sampleProducts) {
    try {
      const { enrichment, enrichedDescription } = await enrichDescription(product);

      console.log(`\n📦 Product: ${product.name}`);
      console.log(`   Brand: ${product.brand} | Price: ${product.price} | Type: ${product.type}`);
      console.log(`\n   Original Description (${product.description.length} chars):`);
      console.log(`   "${product.description}"`);
      console.log(`\n   ✨ AI-Generated Enrichment (${enrichment.length} chars):`);
      console.log(`   "${enrichment}"`);
      console.log(`\n   📝 Final Enriched Description (${enrichedDescription.length} chars):`);
      console.log(`   "${enrichedDescription}"`);
      console.log('\n' + '—'.repeat(80));

      // Add delay to avoid rate limits
      await new Promise(r => setTimeout(r, 500));

    } catch (err) {
      console.error(`\n   ❌ Error: ${err.message}`);
    }
  }

  console.log('\n✅ Proof of concept complete!\n');
  console.log('💡 Next step: If these look good, we can:');
  console.log('   1. Update the scraper to auto-enrich new products');
  console.log('   2. Backfill all 793 existing products');
  console.log('   3. Re-embed all products');
  console.log('   4. Test contextual queries like "beach party" or "shorts under 80"');
}

runTest().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
