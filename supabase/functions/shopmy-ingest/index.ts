// ShopMy creator-shop ingest.
//
// ShopMy is a client-rendered SPA with no SSR payload, but apiv3.shopmy.us
// serves the whole shop as JSON and needs only an Origin header - no auth, no
// browser, no model.
//
// THROTTLING IS NOT OPTIONAL. Every inserted product fires
// trg_products_auto_verify_image and trg_products_auto_embed, each a
// net.http_post to another edge function. One creator shop is ~424 pins; an
// unthrottled insert is ~1,270 edge invocations and ~850 Anthropic calls, which
// degrades every other product in the catalog, not just the new ones.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parseShopMyUrl, mapPin, type PinContext, type MappedProduct } from '../_shared/shopmy.ts';
import { urlAllowed } from '../_shared/ssrf-guard.ts';

const API = 'https://apiv3.shopmy.us';
const HEADERS = {
  // The API returns 401 without this. Nothing else is required.
  'Origin': 'https://shopmy.us',
  'User-Agent': 'catalog-ingest/1.0 (+https://catalog.shop)',
  'Accept': 'application/json',
};

const DEFAULT_BATCH = 25;
const DEFAULT_DELAY_MS = 1500;
const COLLECTION_CONCURRENCY = 4;

// Same shape as every other browser-invoked function in this repo (see
// verify-product-image/index.ts) — supabase.functions.invoke() sends
// Authorization/apikey/x-client-info cross-origin, which forces a preflight.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, attempt = 0): Promise<any> {
  if (!urlAllowed(url)) throw new Error(`blocked url: ${url}`);
  const res = await fetch(url, { headers: HEADERS });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 3) throw new Error(`${res.status} after ${attempt} retries: ${url}`);
    const retryAfter = Number(res.headers.get('retry-after')) || 0;
    // Cap the server-supplied delay: a malformed Retry-After could otherwise
    // stall the whole invocation until the platform timeout.
    await sleep(retryAfter > 0 ? Math.min(retryAfter * 1000, 30_000) : 500 * Math.pow(2, attempt));
    return getJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => '')} — ${url}`);
  return res.json();
}

/** Run tasks with a fixed concurrency ceiling — politeness to the upstream API. */
async function pooled<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ success: false, error: 'method not allowed' }, 405);

  // Auth: service-role JWT (the controller's direct curl calls) OR an admin
  // user JWT (the ProfileCrawlsPanel button). Same detection + admin-profile
  // check as verify-product-image/index.ts:280-298 — this function does the
  // same service-role writes (product inserts, each firing two net.http_post
  // trigger fan-outs) and needs the same gate. The anon key is a legacy
  // project-signed JWT baked into the client bundle, so verify_jwt:true alone
  // authorizes ANY holder of the public key, not just signed-in admins.
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ success: false, error: 'unauthorized' }, 401);
  const token = authHeader.replace('Bearer ', '');
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // Best-effort progress reporting. A failure here must NEVER fail the ingest —
  // the job row is for the operator's benefit, the products are the point. A
  // missing or invalid job_id simply means the run is unreported.
  //
  // Typed via `typeof admin` (not the module-level `ReturnType<typeof
  // createClient>` used elsewhere in this repo) because that pattern fails
  // `deno check` here: esm.sh's @supabase/supabase-js@2 resolves an older
  // SupabaseClient<Database, SchemaName, Schema, ...> shape at this call site
  // but a newer SupabaseClient<Database, ClientOptions, ...> shape for the
  // bare `ReturnType<typeof createClient>` type query, so passing `admin`
  // into a same-file helper typed that way doesn't type-check. Confirmed
  // pre-existing and out of scope: dots-payout/index.ts, generate-look/index.ts
  // and generate-style/index.ts already use that pattern and already fail
  // `deno check` (39 errors on dots-payout, unmodified) for the same reason.
  async function patchJob(jobId: string | null, patch: Record<string, unknown>): Promise<void> {
    if (!jobId) return;
    try {
      await admin.from('crawl_jobs').update(patch).eq('id', jobId);
    } catch { /* progress is not worth failing an ingest over */ }
  }

  let isServiceRole = false;
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload?.role === 'service_role') isServiceRole = true;
    }
  } catch { /* fall through */ }
  if (!isServiceRole) {
    const { data: { user: caller } } = await admin.auth.getUser(token);
    if (!caller) return json({ success: false, error: 'unauthorized' }, 401);
    const { data: prof } = await admin.from('profiles').select('is_admin, role').eq('id', caller.id).maybeSingle();
    const isAdmin = prof?.is_admin === true || prof?.role === 'admin' || prof?.role === 'super_admin';
    if (!isAdmin) return json({ success: false, error: 'admin only' }, 403);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false;   // safe by default: must opt IN to writing
    const batchSize = Math.min(Math.max(Number(body.batch_size) || DEFAULT_BATCH, 1), 25);
    // Guard with isFinite, not `??`. Two ways this silently disables the
    // throttle: Number(undefined) is NaN and NaN is not nullish, so
    // `Number(x) ?? DEFAULT` never falls back; and a garbage string is not
    // nullish either, so `Number(x ?? DEFAULT)` is still NaN. Either way
    // `delayMs > 0` is false, the pause is skipped, and the run goes
    // unthrottled - the one thing the batching design exists to prevent.
    const rawDelay = Number(body.batch_delay_ms ?? DEFAULT_DELAY_MS);
    const delayMs = Math.max(Number.isFinite(rawDelay) ? rawDelay : DEFAULT_DELAY_MS, 0);
    const jobId: string | null = typeof body.job_id === 'string' ? body.job_id : null;

    let username: string | null = body.username ?? null;
    let curatorId: number | null = body.curator_id ?? null;
    let sectionId: number | null = body.section_id ?? null;
    if (body.url) {
      const parsed = parseShopMyUrl(String(body.url));
      if (!parsed) {
        return json({ success: false, error: 'not a ShopMy URL' }, 400);
      }
      username = parsed.username;
      curatorId = parsed.curatorId;
      if (sectionId == null) sectionId = parsed.sectionId;
    }
    if (!username && curatorId == null) {
      return json({ success: false, error: 'provide url or username or curator_id' }, 400);
    }
    // Identifies the shop for the "no collections" 404 below — the only
    // place this is needed, since that 404 fires before there are any
    // collections to resolve a real username from.
    const curatorLabel = username ?? String(curatorId);

    // ── 1. sections + collections ──────────────────────────────────────────
    const listUrl = new URL(`${API}/api/Shop/Collections`);
    // Curator_username and Curator_id are distinct upstream params — one is
    // never a substitute for the other (verified against the live API: a
    // numeric id passed as Curator_username returns success with an empty
    // list). Send exactly whichever identifier this shop resolved to.
    if (username) listUrl.searchParams.set('Curator_username', username);
    else listUrl.searchParams.set('Curator_id', String(curatorId));
    listUrl.searchParams.set('limit', '100');
    if (sectionId != null) listUrl.searchParams.set('Section_id', String(sectionId));

    const list = await getJson(listUrl.toString());
    const sections: Array<{ id: number; title: string }> = list.sections ?? [];
    let collections: Array<{ id: number; name: string; Section_id: number; User_username?: string | null }> =
      list.collections ?? [];
    // ShopMy paginates this list (`hasMoreCollections`); no paging parameter
    // (offset/cursor/page) is documented or evident on the response, so we
    // cannot request page 2. Surface the flag rather than silently ingesting
    // only page 1 and reporting a collection count that looks complete.
    const hasMore = list.hasMoreCollections === true;
    if (body.max_collections) collections = collections.slice(0, Number(body.max_collections));

    if (collections.length === 0) {
      return json({ success: false, error: `no collections for ${curatorLabel}` }, 404);
    }
    const sectionName = (id: number) => sections.find((s) => s.id === id)?.title ?? null;

    // A Curator_id URL carries no username at all — recover the real one
    // from the collections response so raw_data.shopmy.curator (and the
    // products-table filter that reads it) stay a human username, not a
    // numeric id string. Fall back to the id only if ShopMy genuinely didn't
    // return one.
    if (!username) {
      username = collections[0]?.User_username || String(curatorId);
    }

    // ── 2. pins, one request per collection ────────────────────────────────
    const skipped: Record<string, number> = {};
    const mapped: MappedProduct[] = [];
    let pinCount = 0;
    const failures: string[] = [];

    await pooled(collections, COLLECTION_CONCURRENCY, async (c) => {
      let detail: any;
      try {
        detail = await getJson(`${API}/api/Collections/${c.id}`);
      } catch (e) {
        // One bad collection must not abort a 64-collection run.
        failures.push(`collection ${c.id}: ${String(e).slice(0, 120)}`);
        return;
      }
      const ctx: PinContext = {
        curator: username!,
        collectionId: c.id,
        collectionName: c.name,
        sectionName: sectionName(c.Section_id),
      };
      for (const pin of detail.pins ?? []) {
        pinCount++;
        const m = mapPin(pin, ctx);
        if ('skip' in m) { skipped[m.skip] = (skipped[m.skip] ?? 0) + 1; continue; }
        mapped.push(m);
      }
    });

    // Cheap pre-filter so the run summary's `duplicate_in_run` count is
    // useful. This is a REPORTING pre-filter only, NOT the dedup guarantee:
    // it cannot strip tracking params the way normalize_product_url does, so
    // two pins of one product differing only in utm_* slip past it.
    // shopmy_upsert_batch dedups authoritatively in SQL on the normalized URL.
    const seen = new Set<string>();
    const unique = mapped.filter((m) => {
      const key = m.url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
      if (seen.has(key)) { skipped['duplicate_in_run'] = (skipped['duplicate_in_run'] ?? 0) + 1; return false; }
      seen.add(key);
      return true;
    });

    const summary = {
      success: true, curator: username, section_id: sectionId,
      sections: sections.length, collections: collections.length,
      pins: pinCount, mapped: unique.length, skipped,
      failures: failures.length ? failures : undefined,
      has_more: hasMore,
    };

    if (dryRun) {
      return json({ ...summary, dry_run: true, inserted: 0, merged: 0, rows: unique });
    }

    // ── 3. throttled write ─────────────────────────────────────────────────
    // `admin` was already created above for the auth check — reuse it.
    // Earlier batches have already written real rows, so a mid-run failure must
    // still report what landed - otherwise the operator has to query products
    // directly to find out how much of the run committed before deciding
    // whether to re-run.
    await patchJob(jobId, {
      status: 'crawling',
      started_at: new Date().toISOString(),
      total_urls: unique.length,
    });

    let inserted = 0, merged = 0, writeError: string | null = null;
    try {
      for (let i = 0; i < unique.length; i += batchSize) {
        const batch = unique.slice(i, i + batchSize);
        const { data, error } = await admin.rpc('shopmy_upsert_batch', { rows: batch });
        if (error) {
          writeError = `upsert batch ${Math.floor(i / batchSize)}: ${error.message}`;
          break;
        }
        inserted += data?.inserted ?? 0;
        merged += data?.merged ?? 0;
        await patchJob(jobId, { scraped_urls: inserted + merged });
        if (i + batchSize < unique.length && delayMs > 0) await sleep(delayMs);
      }
    } catch (e) {
      // A throw here (library fault, runtime error) would otherwise skip the
      // closing patch entirely. Turn it into a writeError so the row is closed
      // out AND the caller still gets the partial summary.
      writeError = `unexpected error during write: ${String(e).slice(0, 200)}`;
    }

    await patchJob(jobId, {
      status: writeError ? 'failed' : 'done',
      completed_at: new Date().toISOString(),
      scraped_urls: inserted + merged,
      error: writeError,
    });

    return json(
      { ...summary, success: !writeError, dry_run: false, inserted, merged,
        batch_size: batchSize, batch_delay_ms: delayMs,
        error: writeError ?? undefined },
      writeError ? 500 : 200,
    );
  } catch (e) {
    return json({ success: false, error: String(e).slice(0, 500) }, 500);
  }
});
