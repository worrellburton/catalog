// affiliate-com
//
// Server-side proxy for the affiliate.com REST API (https://api.affiliate.com).
// Holds the bearer key in the Supabase Edge Function Secret
// AFFILIATE_COM_API_KEY so it never reaches the browser, and gates the
// caller to Supabase admins (or a service-role JWT).
//
// Endpoints mirror the real affiliate.com v1 surface:
//   GET  /v1/account
//   GET  /v1/networks            GET /v1/networks/{id}
//   GET  /v1/network-groups
//   GET  /v1/merchants           GET /v1/merchants/{id}
//   POST /v1/products            (structured search body)
//   POST /tools/convert/{type}   (url-to-barcode, barcode-to-asin, …)
//
// POST { action, ...args } → { success, data, list?, error }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

const AFFILIATE_BASE = 'https://api.affiliate.com';
const UPSTREAM_TIMEOUT_MS = 30_000;

// Allowlist for the generic `raw` passthrough. GET on these prefixes;
// POST only on /v1/products and /tools/convert.
const ALLOW_PREFIXES = [
  '/v1/account', '/v1/networks', '/v1/network-groups', '/v1/merchants',
  '/v1/products', '/v1/product-lists', '/v1/watch', '/tools/convert', '/v1/omni',
];
const CONVERT_TYPES = new Set([
  'url-to-barcode', 'barcode-to-sku', 'sku-to-barcode', 'asin-to-barcode', 'barcode-to-asin',
]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function isAllowedPath(path: string): boolean {
  return ALLOW_PREFIXES.some(p => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`));
}

type Upstream = { ok: boolean; status: number; body: unknown; error: string | null };

async function callUpstream(
  path: string,
  apiKey: string,
  opts: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<Upstream> {
  const method = opts.method ?? 'GET';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${AFFILIATE_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: method === 'POST' ? JSON.stringify(opts.body ?? {}) : undefined,
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if ((err as { name?: string })?.name === 'AbortError') return { ok: false, status: 0, body: null, error: `upstream_timeout_${UPSTREAM_TIMEOUT_MS}ms` };
    return { ok: false, status: 0, body: null, error: `network_error:${String(err).slice(0, 200)}` };
  }
  clearTimeout(timer);
  const text = await res.text().catch(() => '');
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
  if (!res.ok) {
    const errMsg = (parsed && typeof parsed === 'object' && 'message' in parsed)
      ? String((parsed as { message?: unknown }).message ?? '')
      : text.slice(0, 300);
    return { ok: false, status: res.status, body: parsed ?? text, error: `affiliate_${res.status}:${errMsg}` };
  }
  return { ok: true, status: res.status, body: parsed, error: null };
}

// Extract a row array + pagination meta from affiliate.com's envelope
// (results live under `data`; meta under `meta`/`pagination`).
function normalizeList(body: unknown): { items: unknown[]; total: number | null; page: number | null; per_page: number | null } {
  const b = (body ?? {}) as Record<string, unknown>;
  const candidate =
    (Array.isArray(b.data) && b.data) ||
    (Array.isArray(b.results) && b.results) ||
    (Array.isArray(b.items) && b.items) ||
    (Array.isArray(b.merchants) && b.merchants) ||
    (Array.isArray(b.networks) && b.networks) ||
    (Array.isArray(b.products) && b.products) ||
    (Array.isArray(body) ? (body as unknown[]) : null);
  const meta = (b.meta ?? b.pagination ?? b) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : null);
  return {
    items: Array.isArray(candidate) ? candidate : [],
    total: num(meta.total ?? meta.total_count ?? meta.count),
    page: num(meta.page ?? meta.current_page),
    per_page: num(meta.per_page ?? meta.page_size ?? meta.limit),
  };
}

function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ success: false, error: 'POST only' }, 405);

  const supabaseUrl    = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const apiKey         = Deno.env.get('AFFILIATE_COM_API_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return json({ success: false, error: 'edge function misconfigured' });
  if (!apiKey) return json({ success: false, error: 'AFFILIATE_COM_API_KEY not configured' });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ success: false, error: 'unauthorized' }, 401);
  const token = authHeader.replace('Bearer ', '');
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  let isServiceRole = false;
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload?.role === 'service_role') isServiceRole = true;
    }
  } catch { /* user-JWT path */ }
  if (!isServiceRole) {
    const { data: { user: caller } } = await admin.auth.getUser(token);
    if (!caller) return json({ success: false, error: 'unauthorized' }, 401);
    const { data: prof } = await admin.from('profiles').select('is_admin, role').eq('id', caller.id).maybeSingle();
    const isAdmin = prof?.is_admin === true || prof?.role === 'admin' || prof?.role === 'super_admin';
    if (!isAdmin) return json({ success: false, error: 'admin only' }, 403);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ success: false, error: 'JSON body required' }); }

  const action = body.action as string | undefined;
  if (!action) return json({ success: false, error: 'action required' });

  const page    = Math.max(1, Number(body.page ?? 1) | 0);
  const perPage = Math.min(200, Math.max(1, Number(body.per_page ?? 50) | 0));

  const list = async (path: string, method: 'GET' | 'POST' = 'GET', upBody?: unknown) => {
    const r = await callUpstream(path, apiKey, { method, body: upBody });
    if (!r.ok) return json({ success: false, error: r.error, status: r.status });
    return json({ success: true, data: r.body, list: normalizeList(r.body) });
  };
  const one = async (path: string, method: 'GET' | 'POST' = 'GET', upBody?: unknown) => {
    const r = await callUpstream(path, apiKey, { method, body: upBody });
    if (!r.ok) return json({ success: false, error: r.error, status: r.status });
    return json({ success: true, data: r.body });
  };

  switch (action) {
    case 'ping': {
      const r = await callUpstream('/v1/merchants?per_page=1', apiKey);
      if (!r.ok) return json({ success: false, error: r.error, status: r.status });
      const n = normalizeList(r.body);
      return json({ success: true, data: { ok: true, sample_count: n.items.length, total: n.total, status: r.status } });
    }
    case 'account':
      return one('/v1/account');
    case 'networks':
      return list(`/v1/networks${qs({ page, per_page: perPage, search: body.search ?? body.q })}`);
    case 'network_groups':
      return list(`/v1/network-groups${qs({ page, per_page: perPage })}`);
    case 'list_merchants':
      return list(`/v1/merchants${qs({
        page, per_page: perPage, search: body.search ?? body.q,
        network_ids: body.network_ids, has_logo: body.has_logo,
        product_count_min: body.product_count_min,
      })}`);
    case 'find_merchant': {
      const key = body.id ?? body.slug ?? body.name;
      if (!key) return json({ success: false, error: 'id required' });
      return one(`/v1/merchants/${encodeURIComponent(String(key))}`);
    }
    case 'search_products': {
      // affiliate.com product search is a POST with a structured query.
      const q = (body.q ?? '').toString().trim();
      const search = Array.isArray(body.search)
        ? body.search
        : (q ? [{ field: 'any', value: q, operator: 'LIKE' }] : []);
      const payload: Record<string, unknown> = {
        search,
        page, per_page: perPage,
        sort_by: body.sort_by ?? (q ? 'relevance' : undefined),
        sort_order: body.sort_order,
        merchant_ids: body.merchant_ids,
        exclude_merchant_ids: body.exclude_merchant_ids,
        networks: body.networks,
      };
      return list('/v1/products', 'POST', payload);
    }
    case 'convert': {
      const type = (body.type ?? '').toString();
      if (!CONVERT_TYPES.has(type)) return json({ success: false, error: `type must be one of: ${[...CONVERT_TYPES].join(', ')}` });
      const data = Array.isArray(body.data) ? body.data : (body.value != null ? [body.value] : []);
      if (data.length === 0) return json({ success: false, error: 'data (array) or value required' });
      return one(`/tools/convert/${type}`, 'POST', { data, config: body.config });
    }
    case 'raw': {
      const path = (body.path ?? '').toString();
      const method = (body.method ?? 'GET').toString().toUpperCase() as 'GET' | 'POST';
      if (!path.startsWith('/')) return json({ success: false, error: 'path must start with /' });
      if (method !== 'GET' && method !== 'POST') return json({ success: false, error: 'method must be GET or POST' });
      if (method === 'POST' && !(path.startsWith('/v1/products') || path.startsWith('/tools/convert'))) {
        return json({ success: false, error: 'POST only allowed on /v1/products and /tools/convert' });
      }
      const query = (body.query && typeof body.query === 'object') ? body.query as Record<string, unknown> : {};
      const fullPath = `${path}${path.includes('?') ? '' : qs(query)}`;
      if (!isAllowedPath(fullPath)) return json({ success: false, error: `path not allowlisted: ${path}` }, 403);
      const r = await callUpstream(fullPath, apiKey, { method, body: body.body });
      if (!r.ok) return json({ success: false, error: r.error, status: r.status });
      return json({ success: true, data: r.body, list: normalizeList(r.body) });
    }
    default:
      return json({ success: false, error: `unknown action: ${action}` });
  }
});
