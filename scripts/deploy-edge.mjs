#!/usr/bin/env node
// Deploy Supabase edge function(s) FROM SOURCE — never by hand-pasting the file
// (which risks transcription drift between the repo and what's live). Requires
// the Supabase CLI (`supabase`) installed and authenticated.
//
//   node scripts/deploy-edge.mjs personalize-feed            # one
//   node scripts/deploy-edge.mjs personalize-feed kaizen     # several
//   node scripts/deploy-edge.mjs --all                       # every function
//
// (npm run deploy:edge -- <name> …)

import { execSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';

const PROJECT_REF = 'vtarjrnqvcqbhoclvcur';
const FN_DIR = 'supabase/functions';

let names = process.argv.slice(2);
if (names.includes('--all')) {
  names = readdirSync(FN_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(`${FN_DIR}/${d.name}/index.ts`))
    .map(d => d.name);
}
if (names.length === 0) {
  console.error('usage: node scripts/deploy-edge.mjs <name> [<name> …] | --all');
  process.exit(1);
}

for (const name of names) {
  if (!existsSync(`${FN_DIR}/${name}/index.ts`)) {
    console.error(`✖ no such edge function: ${name} (expected ${FN_DIR}/${name}/index.ts)`);
    process.exit(1);
  }
  console.log(`▶ deploying ${name} …`);
  execSync(`supabase functions deploy ${name} --project-ref ${PROJECT_REF}`, { stdio: 'inherit' });
}
console.log(`✓ deployed ${names.length} function(s) from source`);
