#!/usr/bin/env node
/**
 * CI guard: reject any `typeof import('pkg')` annotation at module top
 * level in app/. That pattern caused the production TDZ 500 ("Cannot
 * access 'Le'/'Fe' before initialization") — Vite/Rollup ends up
 * tracing the dynamic-import target during bundling even though the
 * `typeof` should keep it purely at the type level, and the resulting
 * chunk hoists a reference to an uninitialised binding.
 *
 * Safe alternatives:
 *   1. Type the dynamic-load result as `any` (or a hand-written
 *      interface) and use a string-concatenated module id to hide
 *      the dynamic import from static analysis. See app/utils/sentry.ts
 *      for the established pattern.
 *   2. If you genuinely want the SDK's types, declare them in a
 *      `.d.ts` file or import from a sub-path that's safe to bundle.
 *
 * Run via:  npm run check:no-typeof-import
 * Wired into CI; fails the workflow on a single hit.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['app'];
const EXTS = new Set(['.ts', '.tsx']);
// Allow-list: if you ever need this pattern for a real reason, add the
// path here with a comment explaining why. Empty by default — every
// hit is treated as a bug.
const ALLOWLIST = new Set([
  // 'app/utils/some-path.ts',
]);

/** @type {string[]} */
const offenders = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const st = statSync(path);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      walk(path);
    } else if (EXTS.has(extname(entry))) {
      scan(path);
    }
  }
}

function scan(path) {
  if (ALLOWLIST.has(path)) return;
  const src = readFileSync(path, 'utf8');
  // Match `typeof import(` only when it appears at module-scope. The
  // simplest reliable proxy: the line is not indented inside a
  // function body (no leading whitespace before `let`/`const`/`var`/
  // `type`/`interface`/`export`). False positives are fine — there's
  // no legitimate reason to write this pattern.
  const re = /^(?:export\s+)?(?:let|const|var|type|interface)\s[^=;\n]*\btypeof\s+import\(/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    const lineNo = src.slice(0, m.index).split('\n').length;
    offenders.push(`${path}:${lineNo}  ${m[0].trim()}`);
  }
}

for (const root of ROOTS) {
  try { walk(root); } catch { /* root doesn't exist — fine */ }
}

if (offenders.length > 0) {
  console.error('\n❌ Found `typeof import("...")` at module scope:\n');
  for (const o of offenders) console.error('  ' + o);
  console.error('\nThis pattern caused the production TDZ 500. See');
  console.error('  scripts/check-no-typeof-import.mjs');
  console.error('for the safe alternatives.\n');
  process.exit(1);
}

console.log('✓ no `typeof import(...)` at module scope in app/');
