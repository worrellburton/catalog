#!/usr/bin/env node
// Check enriched products to find the actual product IDs at positions 176-179

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

const { data, error } = await supabase
  .from('products')
  .select('id, name, brand')
  .eq('description_enriched', true)
  .order('id', { ascending: true })
  .range(175, 180);

if (error) {
  console.error('Error:', error);
  process.exit(1);
}

console.log(`Found ${data.length} enriched products at positions 176-181:\n`);
data.forEach((product, index) => {
  console.log(`${176 + index}. ID: ${product.id} - ${product.name} (${product.brand})`);
});
