// Shopnomix affiliate wrapping — every outbound clickout becomes a
// commissionable redirect, attributed to the creator whose surface
// earned it.
//
// Flow: handleOpenBrowser (the single clickout chokepoint in _index)
// calls affiliateRedirect(url, product). We mint a click id, write an
// affiliate_clicks row (fire-and-forget; the row id IS the `cid`), and
// return the Shopnomix redirect:
//   https://r.v2i8b.com/api/v1/bid/redirect?campaign_id=…&url=…&cid=…&source=…
// The daily affiliate-sync function joins Shopnomix conversions back to
// these rows by cid → the creator on the click row gets their share.
//
// Attribution: _index keeps setAffiliateContext() up to date as overlays
// change (look → its creator; creator catalog/profile → that creator;
// bare feed → house). The campaign id is public by design — it appears
// in every redirect URL; the REPORTING keys live server-side only.
//
// Exclusions: Shopnomix runs all brands EXCEPT Amazon and Booking —
// those pass through unwrapped (still recorded, wrapped=false, so we
// know the missed volume).

import { supabase } from '~/utils/supabase';

const REDIRECT_BASE = 'https://r.v2i8b.com/api/v1/bid/redirect';
/** "Catalog Digital - General - Content" — the campaign for in-app
 *  shopper traffic. (The Answer Engine campaign is reserved for
 *  AI-surface traffic and isn't wired into the consumer app.) */
export const SHOPNOMIX_CONTENT_CAMPAIGN = '01KTW95FQHSPFD8SN965HQ60HP';

const EXCLUDED_HOSTS = [
  /(^|\.)amazon\.[a-z.]+$/i,
  /(^|\.)booking\.com$/i,
];

export interface AffiliateContext {
  creatorHandle: string | null;
  lookId: string | null;
  surface: string;
}

let context: AffiliateContext = { creatorHandle: null, lookId: null, surface: 'feed' };

/** _index updates this as overlays open/close so a clickout knows whose
 *  surface earned it without prop-drilling through every component. */
export function setAffiliateContext(next: AffiliateContext): void {
  context = next;
}

// Kill switch — read once per session from app_settings.
let enabled = true;
let enabledLoaded = false;
function loadEnabled(): void {
  if (enabledLoaded || !supabase) return;
  enabledLoaded = true;
  void supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'affiliate_enabled')
    .maybeSingle()
    .then(({ data }) => {
      if (data) enabled = String((data as { value: string | null }).value ?? 'true').trim().toLowerCase() !== 'false';
    });
}

function isWrappable(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return !EXCLUDED_HOSTS.some(rx => rx.test(host));
  } catch {
    return false;
  }
}

/** Wraps an outbound product URL in the Shopnomix redirect and records
 *  the click (with creator attribution) under the returned cid.
 *  Synchronous by design — the redirect URL is built immediately so the
 *  popup/new-tab call keeps its user-gesture; the DB write trails async. */
export function affiliateRedirect(
  url: string,
  product?: { brand?: string | null; name?: string | null; id?: string | null } | null,
): string {
  loadEnabled();
  if (!url || !enabled) return url;
  const wrappable = isWrappable(url);
  const cid = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : '';

  if (supabase && cid) {
    const sb = supabase;
    void (async () => {
      try {
        const { data: { session } } = await sb.auth.getSession();
        await sb.from('affiliate_clicks').insert({
          id: cid,
          user_id: session?.user?.id ?? null,
          product_id: product?.id ?? null,
          product_url: url,
          brand: product?.brand ?? null,
          creator_handle: context.creatorHandle,
          look_id: context.lookId,
          surface: context.surface,
          campaign_id: SHOPNOMIX_CONTENT_CAMPAIGN,
          wrapped: wrappable,
        });
      } catch { /* telemetry must never block a clickout */ }
    })();
  }

  if (!wrappable || !cid) return url;
  const params = new URLSearchParams({
    campaign_id: SHOPNOMIX_CONTENT_CAMPAIGN,
    url,
    cid,
    source: context.surface,
  });
  return `${REDIRECT_BASE}?${params.toString()}`;
}
