// search-backfill — Closed-loop supply agent for cold search misses.
//
// Reads search_query_misses view, clusters by similarity, and for each gap:
//   1. Calls catalog-brainstorm  → specific product search queries
//   2. Calls product-search       → sources real products from Google Shopping
//   3. Marks search_query row     → backfill_status = 'queued'
//
// Designed to be called on a schedule (pg_cron pinger or admin button).
// Is idempotent: skips rows already in 'queued' / 'processing' / 'done'.
//
// Request body (all optional):
//   { limit?: number, dry_run?: boolean }
//
// Response:
//   { ok, processed, skipped, errors }
//
// Required secrets:
//   ANTHROPIC_API_KEY  — catalog-brainstorm
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
//
// Note: calls to catalog-brainstorm and product-search are internal Supabase
// function-to-function invocations via fetch(supabaseUrl + '/functions/v1/...')

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

interface MissRow {
  id: string;
  raw_query: string;
  normalized_query: string;
  query_plan: {
    intent?: string;
    rewrites?: string[];
    constraints?: { gender?: string };
    anchor_name?: string;
  } | null;
  result_count: number;
  served_count: number;
}

// ── Internal function invoker ─────────────────────────────────────────────────
async function invokeFunction(
  supabaseUrl: string,
  serviceKey: string,
  fnName: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const url = `${supabaseUrl}/functions/v1/${fnName}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${fnName} ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// ── Prioritise misses by: frequency × intent quality ─────────────────────────
// Intent priorities: outfit_pairing and occasion_lookup are high-value (clear
// intent → high chance of satisfying with new supply). ambiguous is lowest.
const INTENT_PRIORITY: Record<string, number> = {
  outfit_pairing:  1.5,
  occasion_lookup: 1.3,
  product_find:    1.2,
  vibe_browse:     1.0,
  lookalike:       0.9,
  ambiguous:       0.5,
};

function priorityScore(miss: MissRow): number {
  const intentMult = INTENT_PRIORITY[miss.query_plan?.intent ?? 'ambiguous'] ?? 1.0;
  return miss.served_count * intentMult;
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonRes({ ok: false, error: 'Use POST' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!supabaseUrl || !serviceKey) return jsonRes({ ok: false, error: 'Supabase env missing' }, 500);

  let body: { limit?: number; dry_run?: boolean } = {};
  try { if (req.headers.get('content-length') !== '0') body = await req.json(); } catch { /* empty body ok */ }

  const limit   = Math.min(body.limit ?? 10, 25);
  const dry_run = body.dry_run ?? false;

  const admin = createClient(supabaseUrl, serviceKey);

  // ── Fetch top misses ──────────────────────────────────────────────────────
  const { data: misses, error: fetchErr } = await admin
    .from('search_query_misses')
    .select('id, raw_query, normalized_query, query_plan, result_count, served_count')
    .limit(limit * 2); // fetch extra so we can sort and trim after priority scoring

  if (fetchErr) return jsonRes({ ok: false, error: fetchErr.message }, 500);
  if (!misses?.length) return jsonRes({ ok: true, processed: 0, skipped: 0, message: 'no misses to backfill' });

  // Sort by priority score and take top `limit`
  const prioritised = (misses as MissRow[])
    .sort((a, b) => priorityScore(b) - priorityScore(a))
    .slice(0, limit);

  let processed = 0;
  let skipped   = 0;
  const errors: Array<{ query: string; reason: string }> = [];

  for (const miss of prioritised) {
    // T1.4: emit one row per processed miss into search_backfill_attempts
    // so we can audit cron runs in the dashboard. Without this we have no
    // visibility into why a healthy cron run still leaves backfill_status
    // = 'none' on every miss.
    const attemptStart = Date.now();
    let brainstormedCount = 0;
    let brainstormedQueries: string[] = [];
    let searchCalls = 0;
    let productsInsertedEst = 0;
    const attemptErrors: Array<{ query: string; reason: string }> = [];
    let outcome: 'done' | 'skipped' | 'error' = 'done';

    // Mark as queued immediately to prevent re-processing in concurrent runs
    if (!dry_run) {
      await admin
        .from('search_queries')
        .update({ backfill_status: 'queued' })
        .eq('id', miss.id);
    }

    // Build the catalog label for brainstorming from the best available signal
    const catalogLabel =
      miss.query_plan?.anchor_name ??
      miss.raw_query;

    const gender = miss.query_plan?.constraints?.gender;

    try {
      // ── Step 1: Brainstorm specific product search queries ───────────────
      if (dry_run) {
        processed++;
        outcome = 'done';
        continue;
      }

      const brainstormRes = await invokeFunction(
        supabaseUrl, serviceKey,
        'catalog-brainstorm',
        { catalog: catalogLabel, count: 6, gender }
      ) as { queries?: string[]; error?: string };

      brainstormedQueries = brainstormRes.queries ?? [];
      brainstormedCount = brainstormedQueries.length;

      if (!brainstormedQueries.length) {
        skipped++;
        outcome = 'skipped';
        // Revert queued status — nothing useful to search for
        await admin
          .from('search_queries')
          .update({ backfill_status: 'none' })
          .eq('id', miss.id);
        continue;
      }

      // ── Step 2: Source products via Google Shopping ───────────────────────
      // Fire product-search calls in parallel, up to 3 at a time to avoid
      // overwhelming SerpAPI quota.
      const batchSize = 3;
      const queriesToRun = brainstormedQueries.slice(0, 6);
      for (let i = 0; i < queriesToRun.length; i += batchSize) {
        const batch = queriesToRun.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (q) => {
            searchCalls++;
            try {
              const res = await invokeFunction(supabaseUrl, serviceKey, 'product-search', {
                query: q,
                gender: gender ?? 'unisex',
                ingest: true,  // product-search writes directly to products table when ingest=true
              }) as { count?: number; products?: unknown[] };
              const inserted = (res?.count as number | undefined)
                ?? (Array.isArray(res?.products) ? res.products.length : 0);
              productsInsertedEst += Number(inserted) || 0;
            } catch (err) {
              attemptErrors.push({ query: q, reason: String(err) });
              errors.push({ query: q, reason: String(err) });
            }
          })
        );
      }

      // ── Step 3: Mark done ─────────────────────────────────────────────────
      await admin
        .from('search_queries')
        .update({ backfill_status: 'done' })
        .eq('id', miss.id);

      processed++;
      outcome = 'done';
    } catch (err) {
      attemptErrors.push({ query: miss.raw_query, reason: String(err) });
      errors.push({ query: miss.raw_query, reason: String(err) });
      outcome = 'error';
      // Reset to 'none' so it's retried next run
      if (!dry_run) {
        await admin
          .from('search_queries')
          .update({ backfill_status: 'none' })
          .eq('id', miss.id);
      }
    } finally {
      if (!dry_run) {
        // Record the attempt regardless of outcome — this is how we audit cron.
        await admin.from('search_backfill_attempts').insert({
          search_query_id:    miss.id,
          raw_query:          miss.raw_query,
          catalog_label:      catalogLabel,
          brainstormed_count: brainstormedCount,
          brainstormed:       brainstormedQueries,
          search_calls:       searchCalls,
          products_inserted:  productsInsertedEst,
          errors:             attemptErrors.length ? attemptErrors : null,
          duration_ms:        Date.now() - attemptStart,
          outcome,
        }).then(() => {});
      }
    }
  }

  return jsonRes({
    ok: true,
    processed,
    skipped,
    errors: errors.length ? errors : undefined,
    dry_run,
  });
});
