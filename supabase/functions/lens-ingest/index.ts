// Ingest user-picked Google Lens results into the public.products table
// so they're shoppable in /generate's product picker (and so a
// `?product_url=…` deep-link can resolve them on the try-on page).
//
// Why a service-role edge function instead of a direct client insert:
//   • `products` has no anon insert policy — writes happen exclusively
//     via service-role from product-search.
//   • Embedding is queued here too (best-effort fetch to embed-product)
//     so the product surfaces in semantic search without waiting on
//     the deferred pg_net trigger.
//
// Request body:
//   { items: Array<{
//       name: string;
//       url: string;
//       image_url: string;
//       brand?: string | null;
//       price?: string | null;
//       gender?: 'men' | 'women' | 'unisex';
//   }>, source_image_url?: string }
//
// Response:
//   { success: true, ingested: { id, name, url }[] }
//
// Dedupe is on the `url` column — re-ingesting the same merchant link
// returns the existing row id, so the client can always deep-link
// safely.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

interface IngestItem {
  name: string;
  url: string;
  image_url: string;
  brand?: string | null;
  price?: string | null;
  gender?: 'men' | 'women' | 'unisex';
}

function isLikelyMerchantUrl(u: string): boolean {
  if (!u || !/^https?:\/\//i.test(u)) return false;
  // SerpAPI Lens occasionally returns google.com shopping URLs the
  // try-on pipeline can't resolve into a real PDP. Filter them out so
  // ingest only persists rows the wizard can actually deep-link to.
  return !/^https?:\/\/(www\.)?google\.com\//i.test(u);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonRes({ success: false, error: 'POST only' }, 405);
  }

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const itemsRaw = Array.isArray(body.items) ? body.items as IngestItem[] : [];
    const sourceImageUrl = typeof body.source_image_url === 'string' ? body.source_image_url : null;

    const items = itemsRaw
      .filter(i => i && typeof i.name === 'string' && i.name.trim().length > 0)
      .filter(i => isLikelyMerchantUrl(i.url))
      .filter(i => typeof i.image_url === 'string' && i.image_url.length > 0);

    if (items.length === 0) {
      return jsonRes({ success: false, error: 'no ingestable items (need name + merchant url + image_url)' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceKey) {
      return jsonRes({ success: false, error: 'Supabase env not configured' }, 500);
    }
    const admin = createClient(supabaseUrl, serviceKey);

    // Dedupe by url — return the existing row id if we've ingested this
    // merchant link before (e.g. another user already added it from
    // their own Style sheet).
    const urls = items.map(i => i.url);
    const { data: existing, error: lookupErr } = await admin
      .from('products')
      .select('id, name, url')
      .in('url', urls);
    if (lookupErr) return jsonRes({ success: false, error: `lookup: ${lookupErr.message}` }, 500);
    const existingByUrl = new Map((existing ?? []).map(r => [r.url as string, { id: r.id as string, name: r.name as string }]));

    const toInsert = items
      .filter(i => !existingByUrl.has(i.url))
      .map(i => ({
        name: i.name.trim(),
        brand: (i.brand ?? '').trim() || null,
        price: (i.price ?? '').trim() || null,
        url: i.url,
        image_url: i.image_url,
        gender: i.gender ?? 'unisex',
        is_active: true,
        // Track provenance so the admin panel can filter / audit Lens
        // ingests separately from manual + Shopping-search ingests.
        source: sourceImageUrl ? 'lens' : null,
      }));

    let inserted: { id: string; name: string; url: string }[] = [];
    if (toInsert.length > 0) {
      const { data, error: insertErr } = await admin
        .from('products')
        .insert(toInsert)
        .select('id, name, url');
      if (insertErr) {
        // `source` column may not exist on older deploys — retry once
        // without it so the ingest still succeeds on stale schemas.
        if (insertErr.message.toLowerCase().includes('source')) {
          const retryRows = toInsert.map(({ source: _drop, ...rest }) => rest);
          const retry = await admin.from('products').insert(retryRows).select('id, name, url');
          if (retry.error) return jsonRes({ success: false, error: `insert: ${retry.error.message}` }, 500);
          inserted = (retry.data ?? []) as typeof inserted;
        } else {
          return jsonRes({ success: false, error: `insert: ${insertErr.message}` }, 500);
        }
      } else {
        inserted = (data ?? []) as typeof inserted;
      }

      // Fire embed-product for each newly inserted product so semantic
      // search picks them up without waiting on the deferred trigger.
      await Promise.allSettled(
        inserted.map(row =>
          fetch(`${supabaseUrl}/functions/v1/embed-product`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${serviceKey}`,
              apikey: serviceKey,
            },
            body: JSON.stringify({ id: row.id }),
          })
        )
      );
    }

    // Merge inserted + already-existing so the client always gets back
    // ids for every input it sent.
    const result = items.map(i => {
      const existed = existingByUrl.get(i.url);
      if (existed) return { id: existed.id, name: existed.name, url: i.url, deduped: true };
      const fresh = inserted.find(r => r.url === i.url);
      return fresh
        ? { id: fresh.id, name: fresh.name, url: fresh.url, deduped: false }
        : { id: null, name: i.name, url: i.url, deduped: false, error: 'not inserted' };
    });

    // Phase 9 — back-patch lens_results.ingested_product_id so reopening
    // the Style sheet's Lens overlay can render an "already tried on"
    // badge on tiles the user already shopped. Best-effort: a missing
    // join (e.g. the result row was created before the cache table
    // existed) silently no-ops. Match by `link` since the lens-search
    // edge function uses that as the merchant-URL key.
    const linkToProductId = new Map<string, string>(
      result.filter(r => r.id).map(r => [r.url, r.id as string]),
    );
    if (linkToProductId.size > 0) {
      await Promise.allSettled(
        Array.from(linkToProductId.entries()).map(([link, productId]) =>
          admin
            .from('lens_results')
            .update({ ingested_product_id: productId })
            .eq('link', link)
            .is('ingested_product_id', null),
        ),
      );
    }

    return jsonRes({ success: true, ingested: result, inserted_count: inserted.length });
  } catch (err) {
    return jsonRes({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
