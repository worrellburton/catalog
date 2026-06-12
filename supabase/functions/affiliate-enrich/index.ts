// affiliate-enrich — searches affiliate.com for a DIRECT tracked link
// per product (the founder's "search the API for more links").
//
// For each unchecked product: try url-to-barcode conversion on the
// product URL, search /v1/products by barcode (exact) or by brand+name
// (fuzzy), and harvest any tracked/affiliate URL from the best hit.
// Hits land in products.affiliate_url (+source) — the click router's
// Rail 1, preferred over the Shopnomix wrap. Misses still stamp
// affiliate_checked_at so the nightly cron (09:30 UTC, batch 40)
// marches forward instead of rechecking.
//
// Response shapes are tolerant: any http(s) string under a key hinting
// affiliate/track/outclick/commission counts as the tracked link.
// Auth mirrors kaizen. Key: vault 'affiliate_com_api_key' via the
// get_affiliate_secrets RPC.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const AFFILIATE_BASE = 'https://api.affiliate.com';
const TIMEOUT_MS = 20_000;

async function api(path: string, key: string, body?: unknown): Promise<unknown | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${AFFILIATE_BASE}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Deep-scan an object for a tracked-link looking URL. */
function findTrackedUrl(node: unknown, depth = 0): string | null {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findTrackedUrl(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (typeof v === 'string' && /^https?:\/\//i.test(v) && /affiliat|track|outclick|commission|monet/i.test(k)) {
      return v;
    }
  }
  for (const v of Object.values(node as Record<string, unknown>)) {
    const hit = findTrackedUrl(v, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function firstHit(resp: unknown): unknown | null {
  if (!resp || typeof resp !== 'object') return null;
  const r = resp as Record<string, unknown>;
  const list = (r.data ?? r.results ?? r.products ?? r.items ?? null);
  if (Array.isArray(list)) return list[0] ?? null;
  return r;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  let isService = !!serviceKey && bearer === serviceKey;
  if (!isService && bearer) {
    const probe = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=1`, {
      headers: { apikey: bearer, Authorization: `Bearer ${bearer}` },
    });
    isService = probe.ok;
  }
  if (!isService) return new Response(JSON.stringify({ success: false, error: 'service only' }), { status: 403 });
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const { data: secretRows } = await supabase.rpc('get_affiliate_secrets');
    const key = ((secretRows ?? []) as Array<{ name: string; secret: string }>)
      .find(r => r.name === 'affiliate_com_api_key')?.secret;
    if (!key) return new Response(JSON.stringify({ success: false, error: 'affiliate_com_api_key not in vault' }), { status: 500 });

    const body = await req.json().catch(() => ({}));
    const batch = Math.min(Number(body.batch) || 10, 40);

    const { data: rows } = await supabase
      .from('products')
      .select('id, name, brand, url')
      .is('affiliate_checked_at', null)
      .eq('is_active', true)
      .not('url', 'is', null)
      .limit(batch);

    let found = 0;
    let checked = 0;
    let sample: unknown = null;

    for (const p of (rows ?? []) as Array<{ id: string; name: string; brand: string | null; url: string }>) {
      checked++;
      let tracked: string | null = null;

      // (1) Exact: product URL → barcode → product record with its link.
      const conv = await api('/tools/convert/url-to-barcode', key, { url: p.url });
      const barcode = conv && typeof conv === 'object'
        ? String((conv as Record<string, unknown>).barcode ?? (conv as Record<string, unknown>).data ?? '') || null
        : null;
      if (barcode && /^[0-9]{8,14}$/.test(barcode)) {
        const resp = await api('/v1/products', key, { barcode, limit: 1 });
        tracked = findTrackedUrl(firstHit(resp));
        if (!sample && resp) sample = firstHit(resp);
      }
      // (2) Fuzzy: brand + name search, demand same-brand hit.
      if (!tracked) {
        const resp = await api('/v1/products', key, { query: [p.brand, p.name].filter(Boolean).join(' ').slice(0, 120), limit: 3 });
        const hit = firstHit(resp);
        if (hit && typeof hit === 'object') {
          const hitBrand = String((hit as Record<string, unknown>).brand ?? (hit as Record<string, { name?: string }>).merchant?.name ?? '');
          if (!p.brand || !hitBrand || hitBrand.toLowerCase().includes(p.brand.toLowerCase()) || p.brand.toLowerCase().includes(hitBrand.toLowerCase())) {
            tracked = findTrackedUrl(hit);
          }
          if (!sample) sample = hit;
        }
      }

      await supabase.from('products').update({
        affiliate_url: tracked,
        affiliate_source: tracked ? 'affiliate.com' : null,
        affiliate_checked_at: new Date().toISOString(),
      }).eq('id', p.id);
      if (tracked) found++;
    }

    return new Response(JSON.stringify({ success: true, checked, found, sample }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }), { status: 500 });
  }
});
