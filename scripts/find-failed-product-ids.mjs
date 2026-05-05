#!/usr/bin/env node
// Find the actual product IDs for the 2 failed re-embeddings

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

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

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// Names from the re-embedding log
const FAILED_PRODUCTS = [
  { position: 176, name: 'Conquer Max Performance Jogger - Anthracite' },
  { position: 179, name: '5" Repetition Short - Steel Grey' },
];

console.log('🔍 Finding Product IDs for Failed Re-embeddings\n');

for (const product of FAILED_PRODUCTS) {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, brand')
    .eq('name', product.name)
    .single();

  if (error || !data) {
    console.error(`❌ Product "${product.name}" not found`);
    continue;
  }

  console.log(`${product.position}. ${data.name}`);
  console.log(`    ID: ${data.id}`);
  console.log(`    Brand: ${data.brand}\n`);
}
