#!/usr/bin/env node
/**
 * CI guard: detect module-scope `const` declarations that are
 * referenced BEFORE their declaration line within the same file.
 *
 * This is the bug class that caused the production TDZ 500 ("Cannot
 * access 'Le'/'Fe' before initialization") on /admin/catalogs and
 * /admin/data — `metricChipBase` was declared 127 lines after
 * MetricBadgeRow used it. In dev (unminified) it's invisible because
 * function-declaration hoisting defers the body until call time. In
 * production Rollup transforms function declarations into const
 * expressions during tree-shaking + chunk-splitting; the resulting
 * closure can dereference the missing const before its initialiser
 * has run.
 *
 * Why a single-file scanner without an AST is enough:
 * Rollup's hoisting analysis is also single-file scoped. If you
 * declare a const BEFORE every reference to it, the bundler has no
 * room to misorder. This isn't a perfect detector — it can have
 * false positives (e.g. const used inside a function never called
 * at module init) — but every flagged case IS a latent TDZ bomb
 * waiting for the right chunk layout to detonate.
 *
 * Severity tiers (configurable via CLI flag --strict):
 *
 *   - ERROR (fails CI): hits in `app/routes/admin/*` and `app/root.tsx`.
 *     These are highest-blast-radius (admin tooling, all-page entry).
 *   - WARNING (does not fail CI): hits everywhere else.
 *     Surfaces the risk without breaking the build until each can be
 *     manually triaged and either fixed or allow-listed.
 *
 * With --strict, every hit fails CI. Use this before promoting to
 * main after the codebase has been swept clean.
 *
 * Allowlist: edit ALLOWLIST below to permanently silence a
 * known-safe finding. Use sparingly — the comment must say WHY
 * it's safe (e.g. "const used inside cleanup callback that only
 * runs on user action, never at module init").
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['app'];
const EXTS = new Set(['.ts', '.tsx']);
const MIN_NAME_LENGTH = 4;

const STRICT = process.argv.includes('--strict');

// Files inside these prefixes are ERRORs (fail CI). Everything else
// is a WARNING (informational only).
const ERROR_PREFIXES = [
  'app/routes/admin/',
  'app/root.tsx',
];

// `${file}::${constName}` → reason it's safe.
const ALLOWLIST = new Map([
  // brandCache / similarCache: referenced only from setShopperGender
  // which runs on explicit user action well after module init.
  ['app/services/product-creative.ts::brandCache', 'cleanup ref inside runtime-only mutator'],
  ['app/services/product-creative.ts::similarCache', 'cleanup ref inside runtime-only mutator'],
  // StyleLensSheet docstring mentions StyleLensCropTool — comment,
  // not actual code reference. The strip-comments pass doesn't catch
  // JSDoc-style references inside leading block comments.
  ['app/components/StyleLensSheet.tsx::StyleLensCropTool', 'comment-only reference, not code'],
]);

/** @type {{ file: string; name: string; declLine: number; useLine: number; useText: string; severity: 'error' | 'warn' }[]} */
const findings = [];

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

function severityFor(file) {
  return ERROR_PREFIXES.some(p => file.startsWith(p)) ? 'error' : 'warn';
}

function stripCommentsAndStrings(line) {
  let out = '';
  let i = 0;
  let inStr = null;
  while (i < line.length) {
    const ch = line[i];
    const next = line[i + 1];
    if (!inStr) {
      if (ch === '/' && next === '/') break;
      if (ch === '/' && next === '*') {
        const end = line.indexOf('*/', i + 2);
        i = end === -1 ? line.length : end + 2;
        out += ' ';
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; i++; continue; }
      out += ch;
      i++;
    } else {
      if (ch === '\\') { i += 2; continue; }
      if (ch === inStr) { inStr = null; i++; continue; }
      i++;
    }
  }
  return out;
}

// Detect multi-line block comments. Some files use /** ... */
// JSDoc blocks that span many lines; references inside those should
// not count as code references.
function buildBlockCommentMask(src) {
  const inBlock = new Array(src.length).fill(false);
  let i = 0;
  let active = false;
  while (i < src.length) {
    if (!active && src[i] === '/' && src[i + 1] === '*') {
      active = true; inBlock[i] = inBlock[i + 1] = true; i += 2; continue;
    }
    if (active) {
      inBlock[i] = true;
      if (src[i] === '*' && src[i + 1] === '/') { inBlock[i + 1] = true; active = false; i += 2; continue; }
    }
    i++;
  }
  return inBlock;
}

function lineInBlockComment(src, mask, lineNo) {
  // Return true if the LINE (1-based) is wholly inside a /* ... */ block.
  let start = 0; let cur = 1;
  for (let i = 0; i < src.length && cur < lineNo; i++) if (src[i] === '\n') { start = i + 1; cur++; }
  // Any non-whitespace char on the line that's NOT in a block comment
  // means the line is code (mixed). Conservative: if EVERY non-ws
  // char is in a block, treat as comment-only.
  let sawCode = false;
  for (let i = start; i < src.length && src[i] !== '\n'; i++) {
    if (/\s/.test(src[i])) continue;
    if (!mask[i]) { sawCode = true; break; }
  }
  return !sawCode;
}

function scan(path) {
  const src = readFileSync(path, 'utf8');
  const lines = src.split('\n');
  const blockMask = buildBlockCommentMask(src);

  /** @type {Map<string, number>} */
  const decls = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*[:=]/);
    if (m && m[1].length >= MIN_NAME_LENGTH) {
      decls.set(m[1], i + 1);
    }
  }
  if (decls.size === 0) return;

  for (const [name, declLine] of decls) {
    const allowKey = `${path}::${name}`;
    if (ALLOWLIST.has(allowKey)) continue;

    const re = new RegExp(`\\b${name}\\b`);
    for (let i = 0; i < declLine - 1; i++) {
      const raw = lines[i];
      if (!/^\s+\S/.test(raw)) continue;
      // Skip lines that are wholly inside a block comment.
      if (lineInBlockComment(src, blockMask, i + 1)) continue;
      const stripped = stripCommentsAndStrings(raw);
      if (!re.test(stripped)) continue;
      findings.push({
        file: path,
        name,
        declLine,
        useLine: i + 1,
        useText: raw.trim().slice(0, 100),
        severity: severityFor(path),
      });
      break;
    }
  }
}

for (const root of ROOTS) {
  try { walk(root); } catch { /* root doesn't exist — fine */ }
}

const errors = findings.filter(f => f.severity === 'error');
const warnings = findings.filter(f => f.severity === 'warn');

if (warnings.length > 0) {
  console.warn(`\n⚠  ${warnings.length} latent forward-ref(s) outside admin routes:\n`);
  for (const o of warnings) {
    console.warn(`  ${o.file}:${o.declLine}  const ${o.name} (used at line ${o.useLine})`);
  }
  console.warn('\n   These are warnings only — move the const above the first use');
  console.warn('   when convenient, or allowlist with a justification.\n');
}

if (errors.length > 0) {
  console.error(`\n❌ ${errors.length} TDZ-prone forward-ref(s) in high-risk paths:\n`);
  for (const o of errors) {
    console.error(`  ${o.file}`);
    console.error(`    const ${o.name} declared at line ${o.declLine}`);
    console.error(`    but used at line ${o.useLine}: ${o.useText}`);
    console.error('');
  }
  console.error('In production, Rollup may reorder these into a TDZ-prone');
  console.error('chunk init order. Move the const declaration ABOVE the first');
  console.error('reference.\n');
  process.exit(1);
}

if (STRICT && warnings.length > 0) {
  console.error('--strict: failing CI on warnings.');
  process.exit(1);
}

console.log(`✓ no forward const references in high-risk paths${warnings.length > 0 ? ` (${warnings.length} warnings outside)` : ''}`);
