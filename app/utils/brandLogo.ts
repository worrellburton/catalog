// Derive a Brandfetch CDN logo URL for a product. Prefer the product's own
// store URL (always accurate) and fall back to a slugified brand + ".com".
// Brandfetch returns a 404 for domains it can't resolve; callers should wire
// an <img onError> to hide the tag in that case.
const BRANDFETCH_CLIENT = '1id3n10pdBTarCHI0db';

export function getBrandDomain(
  product: { brand?: string | null; url?: string | null } | null | undefined,
): string | null {
  if (!product) return null;
  if (product.url) {
    try {
      const host = new URL(product.url).hostname.replace(/^www\./, '');
      if (host) return host;
    } catch { /* fall through to brand guess */ }
  }
  if (product.brand) {
    const slug = product.brand.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (slug) return `${slug}.com`;
  }
  return null;
}

export function brandLogoUrl(domain: string): string {
  return `https://cdn.brandfetch.io/${domain}?c=${BRANDFETCH_CLIENT}`;
}
