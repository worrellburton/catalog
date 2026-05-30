// affiliate-com
//
// Comprehensive server-side proxy for the affiliate.com REST API. Keeps
// the bearer API key in the Supabase Edge Function Secret
// AFFILIATE_COM_API_KEY so it never leaves the backend, and authenticates
// the CALLER as a Supabase admin (or service-role JWT) before forwarding.
//
// POST { action, ...args } → { success: true, data } | { success: false, error }
//
// Capability map (mirrors the affiliate.com API surface):
//   ping              -> GET /merchants?per_page=1                      (health)
//   account           -> GET /account                                  (profile + balance)
//   list_merchants    -> GET /merchants?page=&per_page=&q=&category=&status=
//   find_merchant     -> GET /merchants/<id|slug>
//   categories        -> GET /categories
//   search_products   -> GET /products/search?q=&page=&per_page=&merchant_id=&category=&min_price=&max_price=&sort=
//   get_product       -> GET /products/<id>
//   list_deals        -> GET /deals?page=&per_page=&merchant_id=        (coupons / offers)
//   generate_link     -> POST /links { url, merchant_id?, sub_id? }     (deep / tracking link)
//   report_summary    -> GET /reports/summary?start=&end=
//   report_transactions -> GET /reports/transactions?start=&end=&page=&per_page=&status=
//   report_clicks     -> GET /reports/clicks?start=&end=&page=&per_page=
//   list_payments     -> GET /payments?page=&per_page=
//   raw               -> generic allowlisted passthrough { method?, path, query?, body? }
//
// The upstream's exact response shape is normalized client-side; this
// function forwards the raw payload under `data` plus, for paginated
// actions, a best-effort { items, page, per_page, total } envelope.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

const AFFILIATE_BASE = 'https://api.affiliate.com';
const UPSTREAM_TIMEOUT_MS = 30_000;

// Allowlist for the generic `raw` passthrough — keeps the proxy from
// becoming an open relay. Only GETs to these prefixes (plus POST /links)
// are ever forwarded.
const READ_PREFIXES = [
  '/account', '/me', '/merchants', '/categories', '/products',
  '/deals', '/coupons', '/offers', '/reports', '/payments', '/links',
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function isAllowedReadPath(path: string): boolean {
  return READ_PREFIXES.some(p => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`));
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
      body: method === 'POST' && opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
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

// Best-effort extraction of a row array + pagination meta from whatever
// envelope affiliate.com uses (data / results / items / merchants / etc.).
function normalizeList(body: unknown): { items: unknown[]; total: number | null; page: number | null; per_page: number | null } {
  const b = (body ?? {}) as Record<string, unknown>;
  const candidate =
    (Array.isArray(b.data) && b.data) ||
    (Array.isArray(b.results) && b.results) ||
    (Array.isArray(b.items) && b.items) ||
    (Array.isArray(b.merchants) && b.merchants) ||
    (Array.isArray(b.products) && b.products) ||
    (Array.isArray(b.deals) && b.deals) ||
    (Array.isArray(b.transactions) && b.transactions) ||
    (Array.isArray(b.records) && b.records) ||
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

  // Auth: admin JWT or service-role JWT.
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

  // Wrap a list-style upstream call: forwards raw body + normalized envelope.
  const list = async (path: string) => {
    const r = await callUpstream(path, apiKey);
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
      const r = await callUpstream('/merchants?per_page=1', apiKey);
      if (!r.ok) return json({ success: false, error: r.error, status: r.status });
      const n = normalizeList(r.body);
      return json({ success: true, data: { ok: true, sample_count: n.items.length, status: r.status } });
    }
    case 'account':
      return one('/account');
    case 'categories':
      return list('/categories');
    case 'list_merchants':
      return list(`/merchants${qs({ page, per_page: perPage, q: body.q, category: body.category, status: body.status })}`);
    case 'find_merchant': {
      const key = body.id ?? body.slug ?? body.name;
      if (!key) return json({ success: false, error: 'id, slug, or name required' });
      return one(`/merchants/${encodeURIComponent(String(key))}`);
    }
    case 'search_products':
      return list(`/products/search${qs({
        q: body.q, page, per_page: perPage,
        merchant_id: body.merchant_id, category: body.category,
        min_price: body.min_price, max_price: body.max_price, sort: body.sort,
      })}`);
    case 'get_product': {
      if (!body.id) return json({ success: false, error: 'id required' });
      return one(`/products/${encodeURIComponent(String(body.id))}`);
    }
    case 'list_deals':
      return list(`/deals${qs({ page, per_page: perPage, merchant_id: body.merchant_id })}`);
    case 'generate_link': {
      const url = (body.url ?? '').toString().trim();
      if (!url) return json({ success: false, error: 'url required' });
      return one('/links', 'POST', { url, merchant_id: body.merchant_id, sub_id: body.sub_id });
    }
    case 'report_summary':
      return one(`/reports/summary${qs({ start: body.start, end: body.end })}`);
    case 'report_transactions':
      return list(`/reports/transactions${qs({ start: body.start, end: body.end, page, per_page: perPage, status: body.status })}`);
    case 'report_clicks':
      return list(`/reports/clicks${qs({ start: body.start, end: body.end, page, per_page: perPage })}`);
    case 'list_payments':
      return list(`/payments${qs({ page, per_page: perPage })}`);
    case 'raw': {
      const path = (body.path ?? '').toString();
      const method = (body.method ?? 'GET').toString().toUpperCase() as 'GET' | 'POST';
      if (!path.startsWith('/')) return json({ success: false, error: 'path must start with /' });
      if (method === 'POST' && !path.startsWith('/links')) return json({ success: false, error: 'POST only allowed on /links' });
      if (method !== 'GET' && method !== 'POST') return json({ success: false, error: 'method must be GET or POST' });
      const query = (body.query && typeof body.query === 'object') ? body.query as Record<string, unknown> : {};
      const fullPath = `${path}${path.includes('?') ? '' : qs(query)}`;
      if (!isAllowedReadPath(fullPath)) return json({ success: false, error: `path not allowlisted: ${path}` }, 403);
      const r = await callUpstream(fullPath, apiKey, { method, body: body.body });
      if (!r.ok) return json({ success: false, error: r.error, status: r.status });
      return json({ success: true, data: r.body, list: normalizeList(r.body) });
    }
    default:
      return json({ success: false, error: `unknown action: ${action}` });
  }
});
