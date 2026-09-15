// ShopMy pin → products row. Pure functions, no I/O, so the whole mapping
// contract is unit-testable against a checked-in fixture.
//
// ShopMy's shape: Shop → Section (tab) → Collection → Pin (item).
// A pin already carries brand, price, category, one image and the real
// merchant PDP, so this is a mapping job, not a scrape.

export interface ShopMyPin {
  id: number;
  title?: string | null;
  link?: string | null;
  selectedGeoLink?: string | null;
  affiliate_link?: string | null;
  image?: string | null;
  domain?: string | null;
  merchant_data?: { name?: string; domain?: string; source?: string } | null;
  product?: {
    title?: string | null;
    AllBrand_name?: string | null;
    fallbackPrice?: number | null;
    fallbackPriceCurrency?: string | null;
    fallbackUrl?: string | null;
    Category_name?: string | null;
    Department_name?: string | null;
  } | null;
}

export interface PinContext {
  curator: string;
  collectionId: number;
  collectionName: string;
  sectionName: string | null;
}

export interface MappedProduct {
  url: string;
  name: string;
  brand: string | null;
  /**
   * DISPLAY STRING, not a number — `products.price` is `text` and every
   * existing row is formatted ("$25.00", "$19.99"). Some render paths print
   * it raw (app/utils/downloadLookVideo.ts:281), so a bare "820" would show
   * with no currency symbol.
   */
  price: string | null;
  currency: string | null;
  type: string | null;
  image_url: string | null;
  images: string[];
  raw_data: Record<string, unknown>;
}

/** Parse a ShopMy shop URL into the curator and optional section. */
export function parseShopMyUrl(raw: string): { username: string; sectionId: number | null } | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'shopmy.us' && host !== 'shop.my') return null;

  const parts = u.pathname.split('/').filter(Boolean);
  // /shop/<username> and the bare /<username> form are both in the wild.
  const username = parts[0] === 'shop' ? parts[1] : parts[0];
  if (!username) return null;

  const rawSection = u.searchParams.get('Section_id');
  const sectionId = rawSection && /^\d+$/.test(rawSection) ? Number(rawSection) : null;
  return { username, sectionId };
}

/** Paths that are never a single product page. */
function isNonProductLink(link: string): boolean {
  let u: URL;
  try { u = new URL(link); } catch { return true; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname.toLowerCase();
  if (path === '' || path === '/') return true;
  for (const bad of ['/cart', '/checkout', '/search', '/login', '/account']) {
    if (path === bad || path.startsWith(bad + '/') || path.startsWith(bad)) return true;
  }
  // Amazon search / cart, mirroring app/utils/productUrl.ts. /s/ is NOT
  // global - it is Nordstrom's canonical product path.
  if (host === 'amazon.com' || host.endsWith('.amazon.com')) {
    if (path === '/s' || path.startsWith('/s/')) return true;
    if (!path.includes('/dp/') && !path.includes('/gp/product/')) return true;
  }
  return false;
}

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$', CAD: '$', AUD: '$', EUR: '€', GBP: '£', JPY: '¥',
};

/**
 * ShopMy gives a number; `products.price` is text and the catalog convention
 * is a formatted display string ("$25.00"). Match it — some render paths
 * print the column raw.
 */
function formatPrice(amount: number, currency: string | null): string {
  const symbol = CURRENCY_SYMBOL[(currency ?? 'USD').toUpperCase()];
  const body = amount.toFixed(2);
  return symbol ? `${symbol}${body}` : `${body} ${(currency ?? '').toUpperCase()}`.trim();
}

/** "GUCCI | Sol GG Canvas Clog" → "Sol GG Canvas Clog" */
function stripBrandPrefix(title: string, brand: string | null): string {
  const cut = title.indexOf('|');
  if (cut === -1) return title.trim();
  const head = title.slice(0, cut).trim();
  const tail = title.slice(cut + 1).trim();
  if (!tail) return head;
  // Only strip when the head really is the brand, not part of the name.
  if (brand && head.toLowerCase() === brand.toLowerCase()) return tail;
  if (head === head.toUpperCase() && head.length <= 30) return tail;
  return title.trim();
}

export function mapPin(pin: ShopMyPin, ctx: PinContext): MappedProduct | { skip: string } {
  const p = pin.product ?? {};

  const url = pin.selectedGeoLink || pin.link || p.fallbackUrl || '';
  if (!url) return { skip: 'no_link' };
  if (isNonProductLink(url)) return { skip: 'non_product_url' };

  // Brand comes ONLY from ShopMy's own product-catalog match
  // (`product.AllBrand_name`) — NOT `merchant_data.name`, which is the
  // *retailer* (e.g. "Amazon", "Mytheresa"), not the product's brand. Real
  // fixture pins exist where ShopMy failed to match a product but still
  // resolved a retailer from the domain; treating that as "brand" would
  // both mislabel the product and defeat the incomplete-pin skip below.
  const brand = p.AllBrand_name ?? null;
  const priceNum = typeof p.fallbackPrice === 'number' ? p.fallbackPrice : null;
  const currency = p.fallbackPriceCurrency ?? (priceNum !== null ? 'USD' : null);
  const price = priceNum === null ? null : formatPrice(priceNum, currency);

  // A pin with neither brand nor price is a bookmark, not a product.
  if (!brand && price === null) return { skip: 'no_brand_or_price' };

  const rawTitle = (p.title || pin.title || '').trim();
  if (!rawTitle) return { skip: 'no_title' };
  const name = stripBrandPrefix(rawTitle, brand);

  const image = pin.image ?? null;
  if (!image) return { skip: 'no_image' };

  return {
    url,
    name,
    brand,
    price,
    currency,
    type: p.Category_name ?? p.Department_name ?? null,
    image_url: image,
    images: [image],
    raw_data: {
      shopmy: {
        pin_id: pin.id,
        curator: ctx.curator,
        collection_id: ctx.collectionId,
        collection_name: ctx.collectionName,
        section_name: ctx.sectionName,
        // Provenance only. Their Rakuten publisher ID - never used as our link.
        affiliate_link: pin.affiliate_link ?? null,
        merchant_domain: pin.domain ?? pin.merchant_data?.domain ?? null,
        department: p.Department_name ?? null,
      },
    },
  };
}
