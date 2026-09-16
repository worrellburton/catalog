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
import {
  parseShopMyUrl, mapPin, mapCurator, pinAffiliateUrl,
  type PinContext, type MappedProduct, type ShopMyUser, type MappedCurator,
} from '../_shared/shopmy.ts';
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

  /** Close the job row out to a terminal state, then return the error
   *  response. Every early return AFTER the 'crawling' patch must go
   *  through here: the outer catch only catches throws, and a row left at
   *  'crawling' is polled forever by ShopMyIngest and never reaches
   *  onDone(). */
  async function bail(
    jobId: string | null,
    status: number,
    error: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    await patchJob(jobId, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error,
    });
    return json({ ...body, success: false, error }, status);
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
    // ShopMy returns only the FIRST section's collections when no Section_id
    // is given (measured: 13 of 64 for the reference shop), so a multi-section
    // import is genuinely one list call per section, not a filter.
    const requestedSections: (number | null)[] = Array.isArray(body.section_ids) && body.section_ids.length
      ? body.section_ids.map(Number).filter((n: number) => Number.isFinite(n))
      : [sectionId];

    async function listFor(sec: number | null) {
      const listUrl = new URL(`${API}/api/Shop/Collections`);
      // Curator_username and Curator_id are distinct upstream params — one is
      // never a substitute for the other (verified against the live API: a
      // numeric id passed as Curator_username returns success with an empty
      // list). Send exactly whichever identifier this shop resolved to.
      if (username) listUrl.searchParams.set('Curator_username', username);
      else listUrl.searchParams.set('Curator_id', String(curatorId));
      listUrl.searchParams.set('limit', '100');
      if (sec != null) listUrl.searchParams.set('Section_id', String(sec));
      return getJson(listUrl.toString());
    }

    const lists = await pooled(requestedSections, COLLECTION_CONCURRENCY, listFor);
    const sections: Array<{ id: number; title: string }> = lists[0]?.sections ?? [];
    const byId = new Map<number, { id: number; name: string; Section_id: number; User_username?: string | null }>();
    let hasMore = false;
    for (const l of lists) {
      // ShopMy paginates this list (`hasMoreCollections`); no paging parameter
      // (offset/cursor/page) is documented or evident on the response, so we
      // cannot request page 2. Surface the flag rather than silently ingesting
      // only page 1 and reporting a collection count that looks complete.
      if (l?.hasMoreCollections === true) hasMore = true;
      // Dedup by collection id — a section list can legitimately repeat one.
      for (const c of (l?.collections ?? [])) byId.set(c.id, c);
    }
    let collections = Array.from(byId.values());
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
    let pinCount = 0;
    const failures: string[] = [];
    // Held in a ref object, not a bare `let`: TS's control-flow analysis
    // cannot see an assignment made inside the pooled callback, so a `let`
    // stays narrowed to `null` at the read below and types the truthy branch
    // as `never` (TS2698 on the spread). A property read is not narrowed that
    // way. Re-narrowing a widened local does NOT fix it — the widened const
    // inherits the narrow type from its initializer.
    const curatorUser: { current: ShopMyUser | null } = { current: null };

    const perCollection = await pooled(collections, COLLECTION_CONCURRENCY, async (c): Promise<MappedProduct[]> => {
      let detail: any;
      try {
        detail = await getJson(`${API}/api/Collections/${c.id}`);
      } catch (e) {
        // One bad collection must not abort a 64-collection run.
        failures.push(`collection ${c.id}: ${String(e).slice(0, 120)}`);
        return [];
      }
      const ctx: PinContext = {
        curator: username!,
        collectionId: c.id,
        collectionName: c.name,
        sectionName: sectionName(c.Section_id),
      };
      // Whichever collection lands first wins; every one carries the same user.
      if (!curatorUser.current && detail.user) curatorUser.current = detail.user as ShopMyUser;
      const rows: MappedProduct[] = [];
      for (const pin of detail.pins ?? []) {
        pinCount++;
        const m = mapPin(pin, ctx);
        if ('skip' in m) { skipped[m.skip] = (skipped[m.skip] ?? 0) + 1; continue; }
        rows.push(m);
      }
      return rows;
    });

    // pooled writes out[idx] by PICKUP index, so flattening restores
    // collection order regardless of which collection's fetch finished
    // first. Pushing into a shared array here instead would order rows by
    // completion, making sort_order non-deterministic and reshuffling the
    // creator's shop on every re-import.
    const mapped: MappedProduct[] = perCollection.flat();

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

    const captured: ShopMyUser | null = curatorUser.current;

    // A wizard operator may retype the handle at step 2; their choice wins
    // over ShopMy's username, but still gets normalised by mapCurator.
    const mappedCurator: MappedCurator | null = captured
      ? mapCurator(
          typeof body.creator_handle === 'string' && body.creator_handle.trim()
            ? { ...captured, username: body.creator_handle }
            : captured,
        )
      : null;

    const summary = {
      success: true, curator: username, section_id: sectionId,
      sections: sections.length, collections: collections.length,
      pins: pinCount, mapped: unique.length, skipped,
      failures: failures.length ? failures : undefined,
      has_more: hasMore,
      creator: mappedCurator,
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

    // ── 3a. creator ────────────────────────────────────────────────────────
    // Fails CLOSED on a collision with a real creator. A creators row whose
    // source is not 'shopmy' belongs to a signed-up person; silently
    // overwriting their display name, avatar and bio with a scraped
    // storefront's would be a data-loss bug, not an import.
    let creatorWritten = false;
    if (body.include_creator === true) {
      if (!mappedCurator) {
        return bail(jobId, 502, 'ShopMy returned no user block for this shop', summary);
      }
      const { data: existing, error: lookupErr } = await admin
        .from('creators').select('handle, source').eq('handle', mappedCurator.handle).maybeSingle();
      if (lookupErr) {
        return bail(jobId, 500, `creator lookup failed: ${lookupErr.message}`, summary);
      }
      if (existing && existing.source !== 'shopmy') {
        return bail(
          jobId, 409,
          `handle "${mappedCurator.handle}" already belongs to a non-ShopMy creator — choose a different handle`,
          summary,
        );
      }
      const { error: creatorErr } = await admin.from('creators').upsert({
        handle: mappedCurator.handle,
        display_name: mappedCurator.display_name,
        avatar_url: mappedCurator.avatar_url,
        bio: mappedCurator.bio,
        source: 'shopmy',
        source_url: typeof body.url === 'string' ? body.url : null,
      }, { onConflict: 'handle' });
      if (creatorErr) {
        return bail(jobId, 500, `creator write failed: ${creatorErr.message}`, summary);
      }
      creatorWritten = true;
    }

    let inserted = 0, merged = 0, linked = 0, linkMissing = 0, writeError: string | null = null;
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

        // Link AFTER the upsert, per batch: the products must exist for the
        // RPC's join on normalize_product_url to resolve them. Note this
        // links every row in the batch, not just the ones the upsert touched
        // — an unchanged product still belongs to this creator.
        if (creatorWritten && mappedCurator) {
          const linkRows = batch.map((m, j) => {
            const sm = (m.raw_data?.shopmy ?? {}) as Record<string, unknown>;
            const pinId = Number(sm.pin_id);
            // Number(null) / Number('') / Number(false) / Number([]) are all 0,
            // which passes isFinite and fabricates a dead go.shopmy.us/p-0 link
            // that still satisfies a `like 'https://go.shopmy.us/p-%'` check.
            const hasPin = Number.isInteger(pinId) && pinId > 0;
            return {
              url: m.url,
              pin_id: hasPin ? pinId : null,
              affiliate_url: hasPin ? pinAffiliateUrl(pinId) : null,
              collection_name: (sm.collection_name as string) ?? null,
              section_name: (sm.section_name as string) ?? null,
              sort_order: i + j,
            };
          });
          const { data: linkData, error: linkErr } = await admin
            .rpc('shopmy_link_creator_products', { p_handle: mappedCurator.handle, rows: linkRows });
          if (linkErr) {
            writeError = `link batch ${Math.floor(i / batchSize)}: ${linkErr.message}`;
            break;
          }
          linked += linkData?.linked ?? 0;
          // URLs with no matching products row — a batch that upserted but
          // did not resolve on normalize_product_url would otherwise report
          // success with no signal at all.
          linkMissing += linkData?.missing ?? 0;
        }

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
        creator_written: creatorWritten, linked, link_missing: linkMissing,
        batch_size: batchSize, batch_delay_ms: delayMs,
        error: writeError ?? undefined },
      writeError ? 500 : 200,
    );
  } catch (e) {
    return json({ success: false, error: String(e).slice(0, 500) }, 500);
  }
});
