// shopify-connect — JWT-gated. A brand owner/admin requests the Shopify OAuth
// authorize URL for their store. We verify membership (service role), sign a
// state token so the public callback can trust the brand_id, and return the URL.
//
// Deploy with verify_jwt = TRUE.
//
// Required Supabase function secrets:
//   SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_SCOPES, SHOPIFY_REDIRECT_URI
// (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected by the runtime.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
function err(message: string, status = 400) {
  return json({ success: false, error: message }, status);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

// Accept "my-store", "my-store.myshopify.com", or a full URL; normalize to the
// canonical "<store>.myshopify.com" and validate.
function normalizeShop(input: string): string | null {
  let s = (input || '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (s && !s.includes('.')) s = `${s}.myshopify.com`;
  return SHOP_RE.test(s) ? s : null;
}

async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return err('Method not allowed', 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const clientId = Deno.env.get('SHOPIFY_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('SHOPIFY_CLIENT_SECRET') ?? '';
  const scopes = Deno.env.get('SHOPIFY_SCOPES') ?? 'read_products';
  const redirectUri = Deno.env.get('SHOPIFY_REDIRECT_URI') ?? '';

  if (!clientId || !clientSecret || !redirectUri) {
    return err('Shopify is not configured yet. Set SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET / SHOPIFY_REDIRECT_URI.', 503);
  }

  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return err('Missing Authorization header', 401);
  const token = auth.slice(7);

  const svc = createClient(supabaseUrl, serviceKey);
  const { data: { user }, error: userErr } = await svc.auth.getUser(token);
  if (userErr || !user) return err('Unauthorized', 401);

  let body: { brandId?: string; shop?: string };
  try { body = await req.json(); } catch { return err('Invalid JSON body'); }

  const brandId = (body.brandId || '').trim();
  if (!UUID_RE.test(brandId)) return err('Invalid brandId');

  const shop = normalizeShop(body.shop || '');
  if (!shop) return err('Enter a valid Shopify store, e.g. your-store.myshopify.com');

  // Membership check: caller must be an active owner/admin of the brand.
  const { data: member } = await svc
    .from('brand_members')
    .select('role, status')
    .eq('brand_id', brandId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member || member.status !== 'active' || !['owner', 'admin'].includes(member.role)) {
    return err('You must be an owner or admin of this brand to connect Shopify.', 403);
  }

  // Signed state: the callback re-verifies the HMAC to trust brand_id without a DB round-trip.
  // ponytail: signed state (no nonce table). Add a one-time-use nonce table if replay matters.
  const payload = `${brandId}.${Date.now()}.${crypto.randomUUID()}`;
  const sig = await hmacHex(payload, clientSecret);
  const state = `${payload}.${sig}`;

  const authorizeUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`;

  return json({ success: true, url: authorizeUrl });
});
