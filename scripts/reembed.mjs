#!/usr/bin/env node
// Paced re-embed driver for the search overhaul (T0.9).
//
// Calls supabase/functions/embed-entity for every entity in --kind, with
// bounded concurrency so we don't 429 on Anthropic / OpenAI. Reads target
// rows directly from Postgres, then fans out HTTP calls.
//
// Usage:
//   SUPABASE_DB_URL=...                 # postgres connection string
//   SUPABASE_FUNCTIONS_URL=...          # https://<ref>.supabase.co/functions/v1
//   SUPABASE_SERVICE_ROLE_KEY=...       # service role JWT
//
//   node scripts/reembed.mjs --kind=creatives [--force] [--concurrency=4] [--limit=N]
//   node scripts/reembed.mjs --kind=products  [--force] [--concurrency=4] [--limit=N]
//
// Defaults: concurrency=4, no limit, force=false. With --force, every row
// is re-embedded; without it, only rows missing concept_doc / text_embedding.
import pg from 'pg';

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  })
);

const KIND = args.kind;
const FORCE = args.force === 'true';
const CONCURRENCY = parseInt(args.concurrency ?? '4', 10);
const LIMIT = args.limit ? parseInt(args.limit, 10) : null;

if (KIND !== 'creatives' && KIND !== 'products' && KIND !== 'looks') {
  console.error('Usage: node scripts/reembed.mjs --kind=creatives|products|looks [--force] [--concurrency=N] [--limit=N]');
  process.exit(2);
}

const DB_URL = process.env.SUPABASE_DB_URL;
const FN_URL = process.env.SUPABASE_FUNCTIONS_URL?.replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!DB_URL || !FN_URL || !KEY) {
  console.error('Set SUPABASE_DB_URL, SUPABASE_FUNCTIONS_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const ENTITY_TYPE =
  KIND === 'creatives' ? 'creative' :
  KIND === 'products'  ? 'product'  :
                          'look';
const TABLE =
  KIND === 'creatives' ? 'product_creative' :
  KIND === 'products'  ? 'products'         :
                          'looks';
const where =
  KIND === 'creatives' ? `status='live' and enabled=true and video_url is not null${FORCE ? '' : ' and (concept_doc is null or text_embedding is null)'}`
  : KIND === 'products' ? `is_active=true${FORCE ? '' : ' and (concept_doc is null or text_embedding is null)'}`
  : `${FORCE ? '1=1' : '(concept_doc is null or text_embedding is null)'}`;

const client = new pg.Client({ connectionString: DB_URL });
await client.connect();
const sql = `select id from ${TABLE} where ${where} order by created_at desc nulls last${LIMIT ? ` limit ${LIMIT}` : ''}`;
const { rows } = await client.query(sql);
await client.end();

console.log(`[reembed] ${rows.length} ${ENTITY_TYPE} rows to process (force=${FORCE}, concurrency=${CONCURRENCY})`);

let done = 0;
let failed = 0;
const start = Date.now();

async function callOne(id) {
  const url = `${FN_URL}/embed-entity`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ id, entity_type: ENTITY_TYPE, force: FORCE }),
    });
    const text = await res.text();
    if (!res.ok) {
      failed++;
      console.warn(`[fail] ${id} ${res.status} ${text.slice(0, 160)}`);
      return;
    }
  } catch (err) {
    failed++;
    console.warn(`[fail] ${id} ${err.message}`);
    return;
  } finally {
    done++;
    if (done % 10 === 0 || done === rows.length) {
      const rate = done / ((Date.now() - start) / 1000);
      console.log(`[reembed] ${done}/${rows.length} done, ${failed} failed, ${rate.toFixed(2)}/s`);
    }
  }
}

const queue = rows.slice();
const workers = Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const r = queue.shift();
    if (!r) break;
    await callOne(r.id);
  }
});
await Promise.all(workers);

console.log(`[reembed] done. ${done - failed} ok, ${failed} failed in ${((Date.now() - start) / 1000).toFixed(1)}s`);
process.exit(failed > 0 ? 1 : 0);
