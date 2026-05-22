// Heuristic age-group tagger for products.
// Scans products.name + products.description for signals and writes
// age_group where confident. Leaves null for ambiguous/generic products.
//
// Usage:
//   VITE_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/tag-product-age-groups.mjs
//   node scripts/tag-product-age-groups.mjs --dry-run   # preview only
import { createClient } from '@supabase/supabase-js';

const DRY_RUN = process.argv.includes('--dry-run');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

const RULES = [
  { pattern: /\b(junior|kids?|children|toddler|youth|boys?|girls?)\b/i, group: 'teen' },
  { pattern: /\b(teen|teenage|young adult|twenties|20s|student)\b/i,    group: 'young_adult' },
  { pattern: /\b(mature|senior|classic fit|comfort fit|relaxed fit)\b/i, group: 'mature' },
];

const { data: products, error } = await supabase
  .from('products')
  .select('id, name, description')
  .is('age_group', null);

if (error) {
  console.error('Failed to fetch products:', error.message);
  process.exit(1);
}

console.log(`Scanning ${(products ?? []).length} untagged products…`);

let tagged = 0;
for (const p of products ?? []) {
  const text = `${p.name ?? ''} ${p.description ?? ''}`;
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      if (DRY_RUN) {
        console.log(`[dry-run] ${p.id} → ${rule.group}  (${p.name})`);
      } else {
        const { error: upErr } = await supabase
          .from('products')
          .update({ age_group: rule.group })
          .eq('id', p.id);
        if (upErr) console.warn(`  ⚠ failed to update ${p.id}:`, upErr.message);
      }
      tagged++;
      break;
    }
  }
}

console.log(`${DRY_RUN ? '[dry-run] Would tag' : 'Tagged'} ${tagged} of ${(products ?? []).length} products.`);
