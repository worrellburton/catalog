// Affiliate-provider resolution for the admin Data → Products surface.
// Extracted verbatim from app/routes/admin/data.tsx (god-file split #8): pure
// logic, no React, so it lives as a util and keeps the route file focused on UI.
//
// getProductAffiliateProviders() is the public entry point — it picks the
// provider(s) that ACTUALLY pertain to a product (direct tracked link → live
// Shopnomix redirect → known retailer by host → curated brand program → bare
// brand site) instead of dumping a generic provider grid on every row.

import { shopnomixRedirectFor } from '~/services/affiliate';

export interface AffiliateProvider {
  network: string;
  rate: string;
  rateNumeric: number;
  signupUrl: string;
  note?: string;
  /** When present, this is the REAL outbound URL for THIS product (not
   *  a generic sign-up). Renders as "Open ↗" instead of "Sign up ↗". */
  outboundUrl?: string;
  /** Marks the provider as already wired up (no sign-up CTA needed). */
  connected?: boolean;
  /** Sub-label (e.g. merchant name) shown under the network name. */
  merchantName?: string;
  /** Render the outbound URL itself (monospace + Copy) inside the row —
   *  used for the live Shopnomix redirect so the admin can grab the
   *  actual shoppable link. */
  showUrl?: boolean;
}

const BRAND_AFFILIATES: Record<string, AffiliateProvider[]> = {
  'Nike': [
    { network: 'FlexOffers', rate: '11%', rateNumeric: 11, signupUrl: 'https://www.flexoffers.com/', note: 'Top published rate' },
    { network: 'Impact', rate: '8%', rateNumeric: 8, signupUrl: 'https://impact.com/' },
    { network: 'Rakuten Advertising', rate: '5–8%', rateNumeric: 6.5, signupUrl: 'https://rakutenadvertising.com/' },
  ],
  'Zara': [
    { network: 'Skimlinks (auto)', rate: '~5%', rateNumeric: 5, signupUrl: 'https://skimlinks.com/', note: 'No official program' },
    { network: 'Sovrn //Commerce', rate: '~4%', rateNumeric: 4, signupUrl: 'https://www.sovrn.com/commerce/' },
  ],
  'Gucci': [
    { network: 'Rakuten Advertising', rate: '7%', rateNumeric: 7, signupUrl: 'https://rakutenadvertising.com/' },
    { network: 'Awin', rate: '6%', rateNumeric: 6, signupUrl: 'https://www.awin.com/' },
  ],
  'Diesel': [
    { network: 'Awin', rate: '8%', rateNumeric: 8, signupUrl: 'https://www.awin.com/' },
    { network: 'Rakuten Advertising', rate: '6%', rateNumeric: 6, signupUrl: 'https://rakutenadvertising.com/' },
  ],
  'Vince': [
    { network: 'Rakuten Advertising', rate: '10%', rateNumeric: 10, signupUrl: 'https://rakutenadvertising.com/' },
    { network: 'ShareASale', rate: '7%', rateNumeric: 7, signupUrl: 'https://www.shareasale.com/' },
  ],
  'Suitsupply': [
    { network: 'Awin', rate: '9%', rateNumeric: 9, signupUrl: 'https://www.awin.com/' },
    { network: 'Impact', rate: '6%', rateNumeric: 6, signupUrl: 'https://impact.com/' },
  ],
  'Pavoi': [
    { network: 'Amazon Associates', rate: '4%', rateNumeric: 4, signupUrl: 'https://affiliate-program.amazon.com/', note: 'Jewelry tier' },
  ],
  'Windsor': [
    { network: 'ShareASale', rate: '6%', rateNumeric: 6, signupUrl: 'https://www.shareasale.com/' },
  ],
  'Fujifilm': [
    { network: 'Impact', rate: '5%', rateNumeric: 5, signupUrl: 'https://impact.com/' },
    { network: 'Amazon Associates', rate: '2%', rateNumeric: 2, signupUrl: 'https://affiliate-program.amazon.com/', note: 'Electronics tier' },
  ],
  'LUXXFORM': [
    { network: 'Shopify Collabs', rate: '15%', rateNumeric: 15, signupUrl: 'https://www.shopify.com/collabs', note: 'DTC brand' },
  ],
  'Wolf\'s Collections': [
    { network: 'Shopify Collabs', rate: '12%', rateNumeric: 12, signupUrl: 'https://www.shopify.com/collabs', note: 'DTC brand' },
  ],
};

const DEFAULT_AFFILIATES: AffiliateProvider[] = [
  { network: 'Amazon Associates', rate: '3–10%', rateNumeric: 6.5, signupUrl: 'https://affiliate-program.amazon.com/', note: 'Rate varies by category' },
  { network: 'ShareASale', rate: 'Varies', rateNumeric: 5, signupUrl: 'https://www.shareasale.com/', note: 'Brand-negotiated' },
  { network: 'Skimlinks', rate: '~5%', rateNumeric: 5, signupUrl: 'https://skimlinks.com/', note: 'Automatic monetization' },
  { network: 'Impact', rate: 'Varies', rateNumeric: 5, signupUrl: 'https://impact.com/', note: 'Brand-negotiated' },
];

export function getAffiliatesFor(brand: string): AffiliateProvider[] {
  const list = BRAND_AFFILIATES[brand] || DEFAULT_AFFILIATES;
  return [...list].sort((a, b) => b.rateNumeric - a.rateNumeric);
}

// Real retailer programs keyed by URL hostname. Used by
// getProductAffiliateProviders to surface ONLY the network that
// actually monetizes the product's destination, instead of dumping a
// hardcoded grid of Amazon/ShareASale/Skimlinks/Impact on every row.
const KNOWN_RETAILERS: Record<string, { name: string; network: string; rate: string; rateNumeric: number; signupUrl: string }> = {
  'amazon.com':    { name: 'Amazon',    network: 'Amazon Associates',     rate: '3–10%', rateNumeric: 6.5, signupUrl: 'https://affiliate-program.amazon.com/' },
  'amazon.co.uk':  { name: 'Amazon UK', network: 'Amazon Associates UK',  rate: '1–10%', rateNumeric: 5,   signupUrl: 'https://affiliate-program.amazon.co.uk/' },
  'walmart.com':   { name: 'Walmart',   network: 'Walmart Affiliates',    rate: '1–4%',  rateNumeric: 2.5, signupUrl: 'https://affiliates.walmart.com/' },
  'target.com':    { name: 'Target',    network: 'Target Partners',       rate: '1–8%',  rateNumeric: 4,   signupUrl: 'https://partners.target.com/' },
  'nordstrom.com': { name: 'Nordstrom', network: 'Rakuten Advertising',   rate: '2–11%', rateNumeric: 6,   signupUrl: 'https://rakutenadvertising.com/' },
  'shopify.com':   { name: 'Shopify',   network: 'Shopify Collabs',       rate: 'Varies', rateNumeric: 10, signupUrl: 'https://www.shopify.com/collabs' },
  'etsy.com':      { name: 'Etsy',      network: 'Awin (Etsy)',           rate: '4–5%',  rateNumeric: 4.5, signupUrl: 'https://www.awin.com/' },
  'ebay.com':      { name: 'eBay',      network: 'eBay Partner Network',  rate: '1–4%',  rateNumeric: 2.5, signupUrl: 'https://partnernetwork.ebay.com/' },
  'theiconic.com.au': { name: 'THE ICONIC', network: 'Partnerize Australia', rate: '4–8%', rateNumeric: 6, signupUrl: 'https://www.partnerize.com/' },
};

function urlHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./i, ''); } catch { return null; }
}

/** Replaces the old getAffiliatesFor(brand) generic fallback. Picks the
 *  affiliate provider(s) that ACTUALLY pertain to this product:
 *    1. source='affiliate.com' rows → the real affiliate.com tracking
 *       link (already monetized), plus the bare merchant URL.
 *    2. product URL hostname matches a known retailer → just that one.
 *    3. brand is in BRAND_AFFILIATES → the curated brand programs.
 *    4. nothing relevant → only the brand site (no fake provider grid). */
export function getProductAffiliateProviders(p: { brand: string | null; url: string | null; source?: string | null; raw_data?: Record<string, unknown> | null; affiliate_url?: string | null }): AffiliateProvider[] {
  // Rail 1 — a DIRECT tracked link (affiliate.com ingest or the nightly
  // enrich search). The click router prefers this over everything.
  const direct: AffiliateProvider[] = p.affiliate_url ? [{
    network: 'affiliate.com',
    rate: 'Tracked',
    rateNumeric: 99,
    signupUrl: 'https://my.affiliate.com',
    outboundUrl: p.affiliate_url,
    connected: true,
    merchantName: urlHost(p.url) ?? undefined,
    note: 'direct program link — outranks the Shopnomix wrap at clickout',
    showUrl: true,
  }] : [];
  // The LIVE Shopnomix redirect always leads when the brand is in-network:
  // it's the exact link every shopper clickout travels through.
  const shopnomix = p.url ? shopnomixRedirectFor(p.url) : null;
  const live: AffiliateProvider[] = shopnomix ? [{
    network: 'Shopnomix',
    rate: 'Live',
    rateNumeric: 100,
    signupUrl: 'https://docs.shpnmx.com/redirect-link-generator.html',
    outboundUrl: shopnomix,
    connected: true,
    merchantName: urlHost(p.url) ?? undefined,
    note: 'every shopper clickout routes through this redirect',
    showUrl: true,
  }] : [];
  return [...direct, ...live, ...getProductAffiliateProvidersBase(p)];
}

function getProductAffiliateProvidersBase(p: { brand: string | null; url: string | null; source?: string | null; raw_data?: Record<string, unknown> | null }): AffiliateProvider[] {
  // (1) affiliate.com source — surface the actual affiliate URL from raw_data.
  const source = (p as unknown as { source?: string | null }).source ?? null;
  if (source === 'affiliate.com') {
    const raw = (p as unknown as { raw_data?: Record<string, unknown> }).raw_data ?? {};
    const merchantObj = (raw.merchant ?? null) as { name?: string; logo_url?: string } | null;
    const networkObj  = (raw.network  ?? null) as { name?: string } | null;
    const urls = (raw.urls ?? null) as Record<string, string> | null;
    const tracked = urls?.affiliate ?? urls?.outclick ?? urls?.shopnomix
      ?? (raw.commission_url as string | undefined) ?? p.url ?? null;
    const direct  = urls?.direct ?? (raw.direct_url as string | undefined) ?? null;
    const out: AffiliateProvider[] = [];
    if (tracked) {
      out.push({
        network: 'affiliate.com',
        rate: 'Tracked',
        rateNumeric: 99,
        signupUrl: 'https://my.affiliate.com',
        outboundUrl: tracked,
        connected: true,
        merchantName: merchantObj?.name ?? networkObj?.name ?? undefined,
        note: networkObj?.name ? `via ${networkObj.name}` : 'monetized clickout',
      });
    }
    if (direct && direct !== tracked) {
      out.push({
        network: merchantObj?.name ?? 'Merchant site',
        rate: 'Direct',
        rateNumeric: 0,
        signupUrl: direct,
        outboundUrl: direct,
        note: 'no commission',
      });
    }
    return out;
  }
  // (2) Known retailer by URL hostname.
  const host = urlHost(p.url);
  if (host) {
    const key = Object.keys(KNOWN_RETAILERS).find(k => host === k || host.endsWith(`.${k}`));
    const r = key ? KNOWN_RETAILERS[key] : null;
    if (r) {
      return [{
        network: r.network,
        rate: r.rate,
        rateNumeric: r.rateNumeric,
        signupUrl: r.signupUrl,
        merchantName: r.name,
        outboundUrl: p.url ?? undefined,
      }];
    }
  }
  // (3) Brand-specific curated list.
  if (p.brand && BRAND_AFFILIATES[p.brand]) {
    return [...BRAND_AFFILIATES[p.brand]].sort((a, b) => b.rateNumeric - a.rateNumeric);
  }
  // (4) Only the brand site if we have a URL — no generic provider noise.
  if (p.url) {
    return [{
      network: p.brand ?? 'Brand site',
      rate: 'Direct',
      rateNumeric: 0,
      signupUrl: p.url,
      outboundUrl: p.url,
      merchantName: host ?? undefined,
      note: 'no affiliate program detected',
    }];
  }
  return [];
}
