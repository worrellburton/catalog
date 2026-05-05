#!/usr/bin/env node
// Re-embed the 2 products that failed due to transient errors

import { readFileSync } from 'fs';

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

const EMBED_URL = `${SUPABASE_URL}/functions/v1/embed-product`;

// Failed product IDs from re-embedding log
const FAILED_PRODUCT_IDS = [
  '09f4325d-ef7b-4ace-a68d-00d1ce29a202', // Conquer Max Performance Jogger - Anthracite
  'd8a2ce22-7961-43c2-9cfc-62d1958e8df7', // 5" Repetition Short - Steel Grey
];

async function reembedProduct(productId) {
  const res = await fetch(EMBED_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify({ id: productId, force: true }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(JSON.stringify(error));
  }

  return res.json();
}

console.log('🔄 Retrying Failed Re-embeddings\n');
console.log(`Products to retry: ${FAILED_PRODUCT_IDS.length}\n`);
console.log('================================================================================\n');

let succeeded = 0;
let failed = 0;

for (const productId of FAILED_PRODUCT_IDS) {
  try {
    await reembedProduct(productId);
    console.log(`✅ Product ${productId} re-embedded successfully`);
    succeeded++;
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (error) {
    console.error(`❌ Product ${productId} failed: ${error.message}`);
    failed++;
  }
}

console.log('\n================================================================================\n');
console.log('📊 Results:');
console.log(`   ✅ Succeeded: ${succeeded}`);
console.log(`   ❌ Failed: ${failed}`);
console.log(`   Success rate: ${((succeeded / FAILED_PRODUCT_IDS.length) * 100).toFixed(1)}%\n`);

if (failed > 0) {
  process.exit(1);
}
