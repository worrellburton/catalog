#!/usr/bin/env node
// scripts/embed-products.mjs
//
// One-shot batch embedder. Calls the embed-product edge function for every
// active product missing an embedding (or all of them with --force).
//
// Usage:
//   node scripts/embed-products.mjs            # only un-embedded products
//   node scripts/embed-products.mjs --force    # re-embed everything
//
// Requires .env.local with:
//   VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY    (NOT the anon key — embed-product needs service-role)

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');

try {
  const env = readFileSync(envPath, 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
} catch {
  console.warn(`Could not read ${envPath}; relying on already-set env vars.`);
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const force = process.argv.includes('--force');
const CONCURRENCY = 8;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  console.log(`Fetching products${force ? ' (--force, all active)' : ' missing embeddings'} …`);

  const query = supabase
    .from('products')
    .select('id, name')
    .eq('is_active', true)
    .not('name', 'is', null);

  const { data, error } = force ? await query : await query.is('embedding', null);
  if (error) {
    console.error('Fetch failed:', error.message);
    process.exit(1);
  }

  const rows = data ?? [];
  console.log(`${rows.length} products to embed.`);
  if (!rows.length) return;

  let done = 0;
  let failed = 0;
  let skipped = 0;

  async function embedOne(id, name) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/embed-product`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        Authorization:   `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ id, force }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => `HTTP ${res.status}`);
      console.warn(`  ✗ ${id} (${name?.slice(0, 40) ?? '—'}): ${body.slice(0, 200)}`);
      failed++;
      return;
    }
    const json = await res.json().catch(() => ({}));
    if (json.skipped) { skipped++; return; }
    if (json.ok) done++;
  }

  const queue = [...rows];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const row = queue.shift();
      if (!row) break;
      await embedOne(row.id, row.name);
      const total = done + failed + skipped;
      if (total % 25 === 0) {
        console.log(`  … ${total}/${rows.length}  (ok ${done}, skipped ${skipped}, failed ${failed})`);
      }
    }
  });

  await Promise.all(workers);
  console.log(`\nDone. ok=${done}  skipped=${skipped}  failed=${failed}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
