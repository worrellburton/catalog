// affiliate-com
//
// Server-side proxy for the affiliate.com REST API. Keeps the bearer
// API key in the Supabase Edge Function Secret AFFILIATE_COM_API_KEY
// so it never leaves the backend.
//
// Authenticates the CALLER as a Supabase admin (or service-role JWT)
// then forwards to api.affiliate.com with the stored bearer.
//
// POST { action: 'list_merchants' | 'find_merchant' | 'search_products' | 'ping', ...args }
// → 200 { success: true, data: <upstream payload> } | { success: false, error }
//
// Actions:
//   - ping              -> GET /merchants?per_page=1, returns { ok, count }
//   - list_merchants    -> GET /merchants?page=&per_page=  (paginated raw)
//   - find_merchant     -> { name?: string, id?: string } -> GET /merchants/<key>
//   - search_products   -> { q: string, page?, per_page?, fields? } -> /products/search

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

const AFFILIATE_BASE = 'https://api.affiliate.com';
const UPSTREAM_TIMEOUT_MS = 30_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function callUpstream(path: string, apiKey: string): Promise<{ ok: boolean; status: number; body: unknown; error: string | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${AFFILIATE_BASE}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ success: false, error: 'POST only' }, 405);

  const supabaseUrl    = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const apiKey         = Deno.env.get('AFFILIATE_COM_API_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return json({ success: false, error: 'edge function misconfigured' });
  if (!apiKey) return json({ success: false, error: 'AFFILIATE_COM_API_KEY not configured' });

  // Auth: admin JWT or service-role JWT. Same gate the polish/video
  // pipelines use.
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

  let body: { action?: string; name?: string; id?: string | number; q?: string; page?: number; per_page?: number; fields?: string };
  try { body = await req.json(); } catch { return json({ success: false, error: 'JSON body required' }); }

  const action = body.action;
  if (!action) return json({ success: false, error: 'action required' });

  switch (action) {
    case 'ping': {
      const r = await callUpstream('/merchants?per_page=1', apiKey);
      if (!r.ok) return json({ success: false, error: r.error });
      // affiliate.com responses tend to wrap rows under `data` or `merchants`;
      // try a few common shapes to surface a friendly count.
      const data = r.body as Record<string, unknown> | null;
      const rows = (data?.data ?? data?.merchants ?? data?.results ?? data) as unknown[] | undefined;
      const count = Array.isArray(rows) ? rows.length : undefined;
      return json({ success: true, data: { ok: true, sample_count: count, status: r.status } });
    }
    case 'list_merchants': {
      const page = Math.max(1, Number(body.page ?? 1) | 0);
      const perPage = Math.min(500, Math.max(1, Number(body.per_page ?? 100) | 0));
      const r = await callUpstream(`/merchants?page=${page}&per_page=${perPage}`, apiKey);
      if (!r.ok) return json({ success: false, error: r.error });
      return json({ success: true, data: r.body });
    }
    case 'find_merchant': {
      const key = body.id ?? body.name;
      if (!key) return json({ success: false, error: 'name or id required' });
      const r = await callUpstream(`/merchants/${encodeURIComponent(String(key))}`, apiKey);
      if (!r.ok) return json({ success: false, error: r.error });
      return json({ success: true, data: r.body });
    }
    case 'search_products': {
      const q = (body.q ?? '').toString().trim();
      if (!q) return json({ success: false, error: 'q (query) required' });
      const params = new URLSearchParams();
      params.set('q', q);
      if (body.page) params.set('page', String(Number(body.page) | 0));
      if (body.per_page) params.set('per_page', String(Number(body.per_page) | 0));
      if (body.fields) params.set('fields', String(body.fields));
      const r = await callUpstream(`/products/search?${params.toString()}`, apiKey);
      if (!r.ok) return json({ success: false, error: r.error });
      return json({ success: true, data: r.body });
    }
    default:
      return json({ success: false, error: `unknown action: ${action}` });
  }
});
