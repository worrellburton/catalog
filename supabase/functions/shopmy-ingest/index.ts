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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, attempt = 0): Promise<any> {
  if (!urlAllowed(url)) throw new Error(`blocked url: ${url}`);
  const res = await fetch(url, { headers: HEADERS });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 3) throw new Error(`${res.status} after ${attempt} retries: ${url}`);
    const retryAfter = Number(res.headers.get('retry-after')) || 0;
    await sleep(retryAfter > 0 ? retryAfter * 1000 : 500 * Math.pow(2, attempt));
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
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false;   // safe by default: must opt IN to writing
    const batchSize = Math.min(Math.max(Number(body.batch_size) || DEFAULT_BATCH, 1), 25);
    // `??` must sit INSIDE Number(): `Number(body.batch_delay_ms) ?? DEFAULT`
    // never falls back, because Number(undefined) is NaN, not
    // null/undefined — the omitted-field default (the common case) would
    // silently resolve to NaN and defeat the inter-batch throttle pause
    // (delayMs > 0 is false for NaN). This form keeps an explicit 0 usable
    // while still defaulting when the field is absent.
    const delayMs = Math.max(Number(body.batch_delay_ms ?? DEFAULT_DELAY_MS), 0);

    let username: string | null = body.username ?? null;
    let sectionId: number | null = body.section_id ?? null;
    if (body.url) {
      const parsed = parseShopMyUrl(String(body.url));
      if (!parsed) {
        return Response.json({ success: false, error: 'not a ShopMy URL' }, { status: 400 });
      }
      username = parsed.username;
      if (sectionId == null) sectionId = parsed.sectionId;
    }
    if (!username) {
      return Response.json({ success: false, error: 'provide url or username' }, { status: 400 });
    }

    // ── 1. sections + collections ──────────────────────────────────────────
    const listUrl = new URL(`${API}/api/Shop/Collections`);
    listUrl.searchParams.set('Curator_username', username);
    listUrl.searchParams.set('limit', '100');
    if (sectionId != null) listUrl.searchParams.set('Section_id', String(sectionId));

    const list = await getJson(listUrl.toString());
    const sections: Array<{ id: number; title: string }> = list.sections ?? [];
    let collections: Array<{ id: number; name: string; Section_id: number }> = list.collections ?? [];
    if (body.max_collections) collections = collections.slice(0, Number(body.max_collections));

    if (collections.length === 0) {
      return Response.json({ success: false, error: `no collections for ${username}` }, { status: 404 });
    }
    const sectionName = (id: number) => sections.find((s) => s.id === id)?.title ?? null;

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
    };

    if (dryRun) {
      return Response.json({ ...summary, dry_run: true, inserted: 0, merged: 0, rows: unique });
    }

    // ── 3. throttled write ─────────────────────────────────────────────────
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    let inserted = 0, merged = 0;
    for (let i = 0; i < unique.length; i += batchSize) {
      const batch = unique.slice(i, i + batchSize);
      const { data, error } = await admin.rpc('shopmy_upsert_batch', { rows: batch });
      if (error) throw new Error(`upsert batch ${i / batchSize}: ${error.message}`);
      inserted += data?.inserted ?? 0;
      merged += data?.merged ?? 0;
      if (i + batchSize < unique.length && delayMs > 0) await sleep(delayMs);
    }

    return Response.json({ ...summary, dry_run: false, inserted, merged });
  } catch (e) {
    return Response.json({ success: false, error: String(e).slice(0, 500) }, { status: 500 });
  }
});
