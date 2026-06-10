#!/usr/bin/env node
/**
 * Detect React hook deps arrays that reference bindings declared
 * LATER in the same function body. The deps array evaluates
 * immediately when the hook is called; if a referenced name hasn't
 * been declared yet in source order, it's in its temporal dead zone
 * and the render throws "Cannot access X before initialization."
 *
 * This is the exact bug that broke /admin/catalogs (handleRowDrop's
 * deps mentioned `rankable`, declared 600+ lines later) and is also
 * causing /admin/data to 500.
 *
 * Heuristic-only — no AST. Looks for:
 *   - `}, [...]` on its own line preceded by a useCallback/useMemo
 *   - Captures the deps array
 *   - For each identifier in deps, scans the file backward from the
 *     deps line. If the FIRST occurrence (declaration) is AFTER the
 *     deps line, flag it.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['app'];
const EXTS = new Set(['.ts', '.tsx']);

// Identifiers we don't bother checking — built-ins, common React/JS,
// false-positive-prone names.
const IGNORE = new Set([
  'true', 'false', 'null', 'undefined',
  'window', 'document', 'console', 'globalThis',
  'Date', 'JSON', 'Math', 'Object', 'Array', 'Number', 'String', 'Boolean',
  'Promise', 'Map', 'Set', 'RegExp', 'Error',
  'React', 'props', 'children',
]);

const findings = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      walk(p);
    } else if (EXTS.has(extname(entry))) scan(p);
  }
}

function scan(path) {
  const src = readFileSync(path, 'utf8');
  const lines = src.split('\n');

  // Find every `}, [ ... ]` line — but only inside what looks like a
  // useCallback/useMemo block (where the preceding lines contain one
  // of those names within a short backward window).
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^\s*\}\s*,\s*\[([^\]]*)\]/);
    if (!m) continue;

    // Look back ~40 lines for the matching opening hook call.
    let isHook = false;
    for (let j = i - 1; j >= Math.max(0, i - 60); j--) {
      if (/useCallback\s*\(|useMemo\s*\(|useEffect\s*\(/.test(lines[j])) {
        isHook = true;
        break;
      }
      if (/^(function |const |export )/.test(lines[j])) break;
    }
    if (!isHook) continue;

    const depsRaw = m[1].trim();
    if (!depsRaw) continue;

    // Each top-level comma-separated identifier (skip property access
    // like `foo.bar` — first identifier is what matters).
    const names = depsRaw
      .split(',')
      .map(s => s.trim().replace(/[?!.[].*$/, '').replace(/^\(/, ''))
      .filter(n => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n))
      .filter(n => !IGNORE.has(n));

    for (const name of names) {
      // Find first declaration of `name` (const/let/var/function/import).
      const declRe = new RegExp(
        `(^|\\s)(const|let|var|function)\\s+(\\[\\s*)?${name}\\b`
        + `|^\\s*${name}\\s*[:,]?\\s*$`
        + `|import\\s+(\\{[^}]*\\b${name}\\b[^}]*\\}|${name})\\s+from`,
        'm',
      );
      const declLineIdx = src.search(declRe);
      if (declLineIdx === -1) continue; // builtin / not from this file
      const declLine = src.slice(0, declLineIdx).split('\n').length;
      if (declLine > i + 1) {
        findings.push({
          file: path,
          name,
          declLine,
          useLine: i + 1,
        });
      }
    }
  }
}

for (const r of ROOTS) {
  try { walk(r); } catch { /* missing root - fine */ }
}

if (findings.length > 0) {
  console.error('\n❌ React hook deps reference bindings declared LATER:\n');
  for (const f of findings) {
    console.error(`  ${f.file}`);
    console.error(`    deps at line ${f.useLine} mention "${f.name}"`);
    console.error(`    but "${f.name}" is declared at line ${f.declLine}`);
    console.error('');
  }
  console.error('Move the declaration ABOVE the hook, OR refactor the hook');
  console.error('to read the value via useRef.current so it does not need');
  console.error('to appear in the deps array.\n');
  process.exit(1);
}
console.log('✓ no hook deps reference later-declared bindings');
