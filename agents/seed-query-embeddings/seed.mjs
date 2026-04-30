#!/usr/bin/env node
/**
 * seed-query-embeddings — pre-populates the query_embeddings cache.
 *
 * Run once after deploying migration 062. Embeds the top ~200 catalog terms
 * via OpenAI text-embedding-3-small and upserts them into query_embeddings
 * so the very first user search for each term skips the embed round-trip.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OPENAI_API_KEY=... \
 *     node agents/seed-query-embeddings/seed.mjs
 *
 * Idempotent: ON CONFLICT DO NOTHING on the table — re-running is safe.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY   = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SERVICE_KEY || !OPENAI_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / OPENAI_API_KEY');
  process.exit(1);
}

// Top catalog terms — ordered by expected search frequency. Mix of
// single-noun product types, two-word combos, and a few high-intent
// occasion / vibe queries that show up in the search log.
const QUERIES = [
  // Footwear
  'shoes', 'sneakers', 'boots', 'heels', 'sandals', 'loafers', 'flats',
  'running shoes', 'dress shoes', 'white sneakers', 'leather boots',
  'ankle boots', 'platform sneakers', 'mules',

  // Tops
  'shirts', 't-shirts', 'blouses', 'sweaters', 'hoodies', 'cardigans',
  'tank tops', 'crop tops', 'button down shirt', 'graphic tee',
  'oversized shirt', 'linen shirt', 'silk blouse',

  // Bottoms
  'pants', 'jeans', 'trousers', 'shorts', 'skirts', 'leggings',
  'wide leg pants', 'cargo pants', 'denim shorts', 'mini skirt',
  'maxi skirt', 'pleated skirt',

  // Dresses
  'dresses', 'mini dress', 'midi dress', 'maxi dress', 'summer dress',
  'cocktail dress', 'wedding guest dress', 'slip dress', 'wrap dress',

  // Outerwear
  'jackets', 'coats', 'blazers', 'trench coat', 'leather jacket',
  'denim jacket', 'puffer jacket', 'wool coat', 'bomber jacket',

  // Accessories
  'bags', 'handbags', 'backpacks', 'tote bag', 'crossbody bag',
  'sunglasses', 'jewelry', 'necklaces', 'earrings', 'watches',
  'hats', 'belts', 'scarves',

  // Vibes / occasions
  'summer outfit', 'winter outfit', 'fall outfit', 'spring outfit',
  'beach outfit', 'date night outfit', 'work outfit', 'office outfit',
  'wedding guest outfit', 'vacation outfit', 'casual outfit',
  'streetwear', 'minimalist', 'quiet luxury', 'y2k', 'coastal grandmother',
  'old money', 'cottagecore', 'preppy', 'athleisure',

  // Furniture (Phase 3 chairs prep)
  'chairs', 'office chair', 'dining chair', 'accent chair', 'lounge chair',
  'gaming chair', 'recliner', 'desk', 'sofa', 'lamp',

  // Misc high-intent
  'gifts', 'home', 'beauty', 'skincare', 'makeup', 'fragrance',
  'tech', 'fitness', 'yoga', 'travel',
];

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

function normalize(q) {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

function toPgVector(v) {
  return '[' + v.join(',') + ']';
}

async function embed(text) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const vec = json.data?.[0]?.embedding;
  if (!Array.isArray(vec)) throw new Error('OpenAI returned no embedding');
  return vec;
}

async function alreadyCached(key) {
  const { data } = await admin
    .from('query_embeddings')
    .select('query_text')
    .eq('query_text', key)
    .maybeSingle();
  return !!data;
}

async function main() {
  let embedded = 0;
  let skipped = 0;
  let failed = 0;

  for (const raw of QUERIES) {
    const key = normalize(raw);
    try {
      if (await alreadyCached(key)) {
        skipped++;
        process.stdout.write('.');
        continue;
      }
      const vec = await embed(raw);
      const { error } = await admin
        .from('query_embeddings')
        .insert({ query_text: key, embedding: toPgVector(vec) });
      if (error && !/duplicate key/i.test(error.message)) throw error;
      embedded++;
      process.stdout.write('+');
    } catch (err) {
      failed++;
      process.stdout.write('x');
      console.error(`\n  ${key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n\nDone. embedded=${embedded} skipped=${skipped} failed=${failed} total=${QUERIES.length}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
