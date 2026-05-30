#!/usr/bin/env node
// check-admin-routes.mjs
//
// `app/routes/admin/**` is intentionally excluded from Remix's
// file-based auto-router (see `ignoredRouteFiles` in vite.config.ts) —
// every admin route is hand-registered inside the `defineRoutes` block.
// That means creating a new `.tsx` file in `app/routes/admin/` does
// NOTHING on its own: the page 404s in production until the matching
// `route("…", "routes/admin/<file>")` line is added.
//
// This script enforces that contract: every file in `app/routes/admin/`
// (minus the layout + index) MUST appear in vite.config.ts as a
// `routes/admin/<filename>` literal. Exits 1 with a friendly diagnostic
// when any are missing, so the build / pre-push hook catches the gap
// before it ever ships.

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const adminDir = join(repoRoot, 'app', 'routes', 'admin');
const viteConfig = readFileSync(join(repoRoot, 'vite.config.ts'), 'utf8');

// The layout shell + index don't need explicit `route("…", …)` entries
// addressed by file — they're wired by the parent `route("admin", …)`.
// Exclude them from the check.
const SKIP = new Set(['route.tsx', '_index.tsx']);

const files = readdirSync(adminDir, { withFileTypes: true })
  .filter(d => d.isFile() && d.name.endsWith('.tsx') && !SKIP.has(d.name))
  .map(d => d.name);

const missing = [];
const duplicated = [];
for (const file of files) {
  // Match the literal string the registration uses. We don't try to
  // infer the URL — that's an admin choice (e.g. /admin/user/:name from
  // user.$name.tsx) — we just confirm the file is referenced.
  const literal = `routes/admin/${file}`;
  // Count occurrences: 0 = unregistered (404s in prod), 2+ = duplicate
  // route id (hard build failure on Vercel: "Unable to define routes
  // with duplicate route id").
  const count = viteConfig.split(literal).length - 1;
  if (count === 0) missing.push(file);
  else if (count > 1) duplicated.push({ file, count });
}

if (duplicated.length > 0) {
  console.error(`\n[check-admin-routes] ✗ ${duplicated.length} admin route file(s) registered MORE THAN ONCE in vite.config.ts:\n`);
  for (const { file, count } of duplicated) {
    console.error(`  - routes/admin/${file} (appears ${count}×) — remove the duplicate route(...) line.`);
  }
  console.error('\nDuplicate route ids fail the Vercel build ("Unable to define routes with duplicate route id").\n');
  process.exit(1);
}

if (missing.length === 0) {
  console.log(`[check-admin-routes] ✓ all ${files.length} admin route files registered`);
  process.exit(0);
}

console.error(`\n[check-admin-routes] ✗ ${missing.length} admin route file(s) missing from vite.config.ts:\n`);
for (const file of missing) {
  // Best-effort guess at the URL segment (strip extension; $ → :; . → /).
  const segment = file.replace(/\.tsx$/, '').replace(/\$/g, ':').replace(/\./g, '/');
  console.error(`  - app/routes/admin/${file}`);
  console.error(`      add inside the admin defineRoutes block:`);
  console.error(`      route("${segment}", "routes/admin/${file}");\n`);
}
console.error('Why this matters: vite.config.ts has `ignoredRouteFiles: ["routes/admin/**"]`,');
console.error('so unregistered files 404 in production. Fix the registration and retry.\n');
process.exit(1);
