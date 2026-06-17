#!/usr/bin/env node
// scripts/clerk-migration/02-import-to-clerk.mjs
//
// Phase 3, step 2 — create a Clerk user for every row exported by
// 01-export-users.sql, preserving the Supabase UUID as Clerk `external_id`.
// That mapping is what keeps RLS, profiles, and every user_id FK matching
// after cutover (see 01-export-users.sql and README.md).
//
// Usage:
//   node scripts/clerk-migration/02-import-to-clerk.mjs            # import all
//   node scripts/clerk-migration/02-import-to-clerk.mjs --dry-run  # show, don't write
//   node scripts/clerk-migration/02-import-to-clerk.mjs --limit 25 # first 25 only
//   node scripts/clerk-migration/02-import-to-clerk.mjs --input ./users-export.json
//
// Requires .env.local (repo root) with:
//   CLERK_SECRET_KEY   (sk_test_… / sk_live_… — server secret, NEVER the publishable key)
//
// Safe to re-run: results are written to import-results.json and already-created
// users (matched by external_id, locally or in Clerk) are skipped.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Env (.env.local parser, matching the other scripts) ──────────────────
const envPath = resolve(__dirname, '..', '..', '.env.local');
try {
  const env = readFileSync(envPath, 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
} catch {
  console.warn(`Could not read ${envPath}; relying on already-set env vars.`);
}

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
if (!CLERK_SECRET_KEY) {
  console.error('Missing CLERK_SECRET_KEY (server secret key, sk_…). Aborting.');
  process.exit(1);
}

// ── Args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitArg = args.indexOf('--limit');
const LIMIT = limitArg !== -1 ? Number(args[limitArg + 1]) : Infinity;
const inputArg = args.indexOf('--input');
const INPUT = resolve(
  inputArg !== -1 ? args[inputArg + 1] : resolve(__dirname, 'users-export.json'),
);
const RESULTS = resolve(__dirname, 'import-results.json');

// Clerk Backend API rate limit is generous but finite; one create per request.
// Keep concurrency modest and back off on 429 so a big import can't get
// throttled into failures.
const CONCURRENCY = 4;
const CLERK_API = 'https://api.clerk.com/v1';

// ── Load export + prior results ──────────────────────────────────────────
if (!existsSync(INPUT)) {
  console.error(`Input not found: ${INPUT}\nRun 01-export-users.sql and save its JSON there first.`);
  process.exit(1);
}
let users = JSON.parse(readFileSync(INPUT, 'utf8'));
if (!Array.isArray(users)) {
  console.error('Export JSON must be an array (the value of the `users` column).');
  process.exit(1);
}

/** supabase_id -> { status, clerk_id?, error? }. Lets a re-run skip done work. */
const results = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, 'utf8')) : {};
const saveResults = () => writeFileSync(RESULTS, JSON.stringify(results, null, 2));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Clerk calls ──────────────────────────────────────────────────────────
async function clerkFetch(path, init, attempt = 0) {
  const res = await fetch(`${CLERK_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${CLERK_SECRET_KEY}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (res.status === 429 && attempt < 5) {
    const retryAfter = Number(res.headers.get('retry-after')) || 2 ** attempt;
    await sleep(retryAfter * 1000);
    return clerkFetch(path, init, attempt + 1);
  }
  return res;
}

/** True if Clerk already has a user with this external_id (idempotency across
 *  runs even if import-results.json was lost). */
async function existsInClerk(externalId) {
  const res = await clerkFetch(`/users?external_id=${encodeURIComponent(externalId)}&limit=1`, {
    method: 'GET',
  });
  if (!res.ok) return null;
  const list = await res.json();
  const arr = Array.isArray(list) ? list : list?.data;
  return arr && arr.length ? arr[0].id : null;
}

/** Build the Clerk CreateUser body from one exported row. Returns null when the
 *  row can't become an identifiable Clerk user (no email and no OAuth identity). */
function buildBody(u) {
  const body = { external_id: u.supabase_id };
  if (u.email) body.email_address = [u.email];

  if (u.password_bcrypt) {
    // Supabase/GoTrue stores bcrypt ($2a/$2b) digests — Clerk imports these
    // directly, so password users never have to reset.
    body.password_digest = u.password_bcrypt;
    body.password_hasher = 'bcrypt';
    body.skip_password_checks = true; // legacy passwords may fail current rules
  } else {
    // OAuth-only / passwordless. Clerk links the provider (e.g. Google) to this
    // imported user on first sign-in by matching the email, and external_id keeps
    // them tied to all their existing data.
    body.skip_password_requirement = true;
  }

  if (!body.email_address) return null;
  return body;
}

// ── Run ──────────────────────────────────────────────────────────────────
if (LIMIT !== Infinity) users = users.slice(0, LIMIT);

let created = 0, skipped = 0, failed = 0, ineligible = 0;

async function processOne(u) {
  const id = u.supabase_id;
  if (results[id]?.status === 'created' || results[id]?.status === 'exists') { skipped++; return; }

  const body = buildBody(u);
  if (!body) {
    ineligible++;
    results[id] = { status: 'ineligible', error: 'no email or oauth identity' };
    return;
  }

  if (DRY_RUN) {
    const redacted = { ...body, password_digest: body.password_digest ? '<bcrypt>' : undefined };
    console.log('would create:', JSON.stringify(redacted));
    return;
  }

  const already = await existsInClerk(id);
  if (already) {
    skipped++;
    results[id] = { status: 'exists', clerk_id: already };
    return;
  }

  const res = await clerkFetch('/users', { method: 'POST', body: JSON.stringify(body) });
  if (res.ok) {
    const user = await res.json();
    created++;
    results[id] = { status: 'created', clerk_id: user.id };
  } else {
    const text = await res.text();
    failed++;
    results[id] = { status: 'failed', error: `${res.status} ${text.slice(0, 300)}` };
    console.error(`FAIL ${u.email || id}: ${res.status} ${text.slice(0, 200)}`);
  }
}

console.log(
  `${DRY_RUN ? '[dry-run] ' : ''}Importing ${users.length} user(s) to Clerk ` +
  `(concurrency ${CONCURRENCY})…`,
);

// Simple bounded-concurrency worker pool over the queue.
const queue = [...users];
async function worker() {
  while (queue.length) {
    await processOne(queue.shift());
    if (!DRY_RUN && (created + skipped + failed) % 25 === 0) saveResults();
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

if (!DRY_RUN) saveResults();

console.log('\nDone.');
console.log(`  created:    ${created}`);
console.log(`  skipped:    ${skipped} (already in Clerk)`);
console.log(`  ineligible: ${ineligible} (no email/oauth)`);
console.log(`  failed:     ${failed}`);
if (!DRY_RUN) console.log(`  results →   ${RESULTS}`);
if (failed) process.exitCode = 1;
