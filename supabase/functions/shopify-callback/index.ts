// shopify-callback — PUBLIC (Shopify redirects here after the merchant approves).
// No Supabase JWT; authenticated by Shopify's query HMAC + our signed state.
// Verifies HMAC, validates state, exchanges the code for an access token, stores
// the session (service role), marks the brand connected, and redirects back to
// the portal.
//
// Deploy with verify_jwt = FALSE.
//
// Required Supabase function secrets:
//   SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_APP_REDIRECT
//   (SHOPIFY_APP_REDIRECT = portal base, e.g. https://catalog.shop)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const STATE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time string compare — never `===` on a signature.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const appRedirect = (Deno.env.get('SHOPIFY_APP_REDIRECT') ?? 'https://catalog.shop').replace(/\/$/, '');
  const back = (q: string) => Response.redirect(`${appRedirect}/partners/store?${q}`, 302);

  const clientId = Deno.env.get('SHOPIFY_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('SHOPIFY_CLIENT_SECRET') ?? '';
  if (!clientId || !clientSecret) return back('error=not_configured');

  const params = url.searchParams;
  const shop = (params.get('shop') ?? '').toLowerCase();
  const code = params.get('code') ?? '';
  const state = params.get('state') ?? '';
  const hmac = params.get('hmac') ?? '';

  if (!SHOP_RE.test(shop)) return back('error=bad_shop');
  if (!code) return back('error=missing_code');

  // 1) Verify Shopify's request HMAC over the RAW, sorted query string (minus
  //    hmac/signature) — must use the encoded values exactly as received.
  const message = url.search.replace(/^\?/, '')
    .split('&')
    .filter((p) => p && !p.startsWith('hmac=') && !p.startsWith('signature='))
    .sort()
    .join('&');
  const expectedHmac = await hmacHex(message, clientSecret);
  if (!hmac || !timingSafeEqual(expectedHmac, hmac)) return back('error=bad_hmac');

  // 2) Verify our signed state and extract brand_id.
  const lastDot = state.lastIndexOf('.');
  if (lastDot < 0) return back('error=bad_state');
  const statePayload = state.slice(0, lastDot);
  const stateSig = state.slice(lastDot + 1);
  const expectedStateSig = await hmacHex(statePayload, clientSecret);
  if (!stateSig || !timingSafeEqual(expectedStateSig, stateSig)) return back('error=bad_state');

  const [brandId, tsStr] = statePayload.split('.');
  if (!UUID_RE.test(brandId)) return back('error=bad_state');
  if (!tsStr || Date.now() - Number(tsStr) > STATE_TTL_MS) return back('error=state_expired');

  // 3) Exchange the code for an Admin API access token.
  let accessToken = '', scope = '';
  try {
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    if (!res.ok) return back('error=token_exchange_failed');
    const tok = await res.json();
    accessToken = tok.access_token ?? '';
    scope = tok.scope ?? '';
  } catch {
    return back('error=token_exchange_failed');
  }
  if (!accessToken) return back('error=token_exchange_failed');

  // 4) Persist the session (service role; RLS-locked table) + mark brand connected.
  const svc = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const nowIso = new Date().toISOString();
  const { error: upsertErr } = await svc.from('brand_shopify_sessions').upsert({
    brand_id: brandId, shop, access_token: accessToken, scope,
    connected_at: nowIso, updated_at: nowIso,
  }, { onConflict: 'brand_id' });
  if (upsertErr) return back('error=persist_failed');

  await svc.from('brands').update({ shopify_shop: shop }).eq('id', brandId);

  return back('connected=1');
});
