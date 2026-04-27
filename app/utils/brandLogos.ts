// brandLogos — Brandfetch CDN URL builder + product → domain inference.
//
// The CDN takes a registered-domain (e.g. "apple.com") and serves a
// best-fit logo automatically:
//   https://cdn.brandfetch.io/domain/<host>?c=<client-id>
//
// We don't store domains on products; we infer them from product.url
// (the canonical brand-site link the scraper captured). Falls back to a
// brand-name → guessed-domain heuristic ("alo yoga" → "aloyoga.com")
// when there's no URL, so newly-added products without scraped URLs
// still get a logo most of the time.

const BRANDFETCH_CLIENT_ID = '1id3n10pdBTarCHI0db';

/** Strip a hostname down to its registered domain (drops www/m/store/etc).
 *  Conservative — keeps everything past the second-to-last dot, which
 *  works for most fashion retailers. Co.uk-style two-part TLDs become
 *  three-part keep, which Brandfetch handles. */
function rootDomain(host: string): string {
  const lower = host.toLowerCase().replace(/^(www|m|store|shop)\./, '');
  return lower;
}

function hostnameFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return rootDomain(new URL(url).hostname);
  } catch { return null; }
}

/** Convert a brand name to a guessed domain. Lowercase, strip non-alnum,
 *  append ".com". Misses on multi-word brands without single-word domains
 *  but covers most cases (Nike, Apple, Adidas, etc.). */
function guessDomainFromBrand(brand: string | null | undefined): string | null {
  if (!brand) return null;
  const slug = brand.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!slug) return null;
  return `${slug}.com`;
}

/** Returns a Brandfetch logo URL for a product, or null if we can't infer
 *  a domain. The optional `theme` param asks the CDN for a logo variant
 *  designed for that surface — 'dark' returns a light-glyph version that
 *  reads on dark backgrounds, 'light' returns the canonical dark glyphs.
 *
 *  Brand-name-derived domain is preferred over the product URL because
 *  the URL is often a Google Shopping search redirect (the scraper
 *  source), which would resolve to google.com and return Google's logo
 *  instead of the actual brand. The brand name → "<slug>.com" guess hits
 *  cleanly for most fashion + beauty brands (PHLUR, Aerie, Old Navy …). */
export function brandLogoUrlFor(opts: { brand?: string | null; url?: string | null; theme?: 'light' | 'dark' }): string | null {
  const fromBrand = guessDomainFromBrand(opts.brand);
  const fromUrl = hostnameFromUrl(opts.url);
  // Skip URL-derived domain if it looks like an aggregator / search engine.
  const aggregator = fromUrl ? /(^|\.)(google|amazon|bing|duckduckgo|shopping|ebay|walmart)\./i.test(fromUrl) : false;
  const domain = fromBrand ?? (aggregator ? null : fromUrl);
  if (!domain) return null;
  const params = new URLSearchParams();
  params.set('c', BRANDFETCH_CLIENT_ID);
  if (opts.theme) params.set('theme', opts.theme);
  // fallback=lettermark — if Brandfetch has no logo for the domain, it
  // returns a clean stylized text mark instead of a 404 / Google G.
  params.set('fallback', 'lettermark');
  return `https://cdn.brandfetch.io/${encodeURIComponent(domain)}?${params.toString()}`;
}
