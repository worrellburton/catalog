#!/usr/bin/env node
// Route-coverage guard. Admin routes are registered MANUALLY in vite.config.ts
// (ignoredRouteFiles disables auto-discovery), so it's easy to add a sidebar
// link or a route file without wiring the route() entry — which ships a 404 or
// a blank page (this already bit /admin/daily-feed and /admin/sharing).
//
// Asserts every /admin/* target in the sidebar nav + command search (the
// navItems / searchItems arrays in route.tsx) resolves to a registered route in
// vite.config.ts. Run in CI so the build fails instead of production.

import { readFileSync } from 'node:fs';

const routeTsx = readFileSync('app/routes/admin/route.tsx', 'utf8');
const vite = readFileSync('vite.config.ts', 'utf8');

// Grab a `const <name> ... = [ ... ]` array literal by brace-matching the [].
function arrayBlock(src, declRe) {
  const start = src.search(declRe);
  if (start < 0) return '';
  // Start at the '=' so we skip the `[]` in the type annotation (NavItem[]).
  const eq = src.indexOf('=', start);
  const open = src.indexOf('[', eq < 0 ? start : eq);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']' && --depth === 0) return src.slice(open, i + 1);
  }
  return '';
}

// Targets: only the nav + search arrays (NOT arbitrary `to:` like the recent-
// items MRU list, which legitimately points at dynamic :param routes).
const blocks = arrayBlock(routeTsx, /const navItems\b/) + arrayBlock(routeTsx, /const searchItems\b/);
const targets = [...blocks.matchAll(/\bto:\s*['"`](\/admin[^'"`]*)['"`]/g)]
  .map(m => m[1].split('?')[0].replace(/\/+$/, ''))
  .filter(Boolean);

// Registered routes — derived from each route's FILE name, whose dotted
// convention encodes the full nested path (ui.brand.tsx → /admin/ui/brand,
// model.equity.holder.$id.tsx → /admin/model/equity/holder/:id). Robust to
// nesting without parsing the route() tree.
const registered = new Set(['/admin']);
for (const m of vite.matchAll(/route\(\s*"[^"]*"\s*,\s*"routes\/admin\/([^"]+)\.tsx"/g)) {
  const segs = m[1].split('.')
    .filter(s => s !== '_index' && s !== 'route')
    .map(s => (s.startsWith('$') ? `:${s.slice(1)}` : s));
  registered.add('/admin' + (segs.length ? `/${segs.join('/')}` : ''));
}
const patterns = [...registered];

// A target matches a registered pattern if every segment is equal or the
// pattern segment is a :param wildcard.
const matches = (target, pattern) => {
  const a = target.split('/');
  const b = pattern.split('/');
  return a.length === b.length && b.every((seg, i) => seg.startsWith(':') || seg === a[i]);
};

const missing = [...new Set(targets)].filter(t => !patterns.some(p => matches(t, p)));
if (missing.length) {
  console.error('✖ admin nav/search targets with NO registered route in vite.config.ts:');
  for (const p of missing) console.error(`    ${p}`);
  console.error('\nAdd a route("<path>", "routes/admin/<file>.tsx") for each, or fix the nav `to`.');
  process.exit(1);
}
console.log(`✓ all ${new Set(targets).size} admin nav/search targets are registered`);
