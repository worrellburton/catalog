// affiliate-com service
//
// Typed client for the `affiliate-com` edge function (server-side proxy
// that holds the AFFILIATE_COM_API_KEY secret). Every call goes through
// supabase.functions.invoke so the key never touches the browser.
//
// The upstream affiliate.com response schema is not strictly known, so
// the row types below are intentionally loose (Record-ish with the
// fields we expect) and every accessor is defensive. `normalizeList`
// shapes the common pagination envelopes server-side; here we just
// surface them.

import { supabase } from '~/utils/supabase';

// ── Types ───────────────────────────────────────────────────────────

export interface AffiliateListMeta {
  items: unknown[];
  total: number | null;
  page: number | null;
  per_page: number | null;
}

export interface AffiliateResult<T = unknown> {
  success: boolean;
  data: T | null;
  list?: AffiliateListMeta;
  error: string | null;
  status?: number;
}

/** A merchant / advertiser program. Loose — real keys vary by network. */
export interface AffiliateMerchant {
  id?: string | number;
  slug?: string;
  name?: string;
  logo?: string | null;
  category?: string | null;
  categories?: string[];
  commission?: string | null;
  commission_rate?: string | number | null;
  cookie_duration?: string | null;
  status?: string | null;
  url?: string | null;
  description?: string | null;
  [k: string]: unknown;
}

/** A product returned by the product search. */
export interface AffiliateProduct {
  id?: string | number;
  title?: string;
  name?: string;
  brand?: string | null;
  merchant?: string | null;
  merchant_id?: string | number | null;
  price?: string | number | null;
  sale_price?: string | number | null;
  currency?: string | null;
  image?: string | null;
  image_url?: string | null;
  url?: string | null;
  affiliate_url?: string | null;
  deep_link?: string | null;
  category?: string | null;
  description?: string | null;
  [k: string]: unknown;
}

/** A network / network-group (the affiliate programs aggregated). */
export interface AffiliateNetwork {
  id?: string | number;
  name?: string;
  slug?: string;
  group?: string | null;
  status?: string | null;
  merchant_count?: number | null;
  [k: string]: unknown;
}

export interface AffiliateAccount {
  id?: string | number;
  name?: string | null;
  email?: string | null;
  balance?: string | number | null;
  currency?: string | null;
  status?: string | null;
  [k: string]: unknown;
}

// ── Low-level invoke ────────────────────────────────────────────────

async function call<T = unknown>(action: string, args: Record<string, unknown> = {}): Promise<AffiliateResult<T>> {
  if (!supabase) return { success: false, data: null, error: 'Supabase not configured' };
  try {
    const { data, error } = await supabase.functions.invoke('affiliate-com', { body: { action, ...args } });
    if (error) return { success: false, data: null, error: error.message || 'invoke error' };
    if (!data?.success) return { success: false, data: null, error: data?.error || 'unknown', status: data?.status };
    return { success: true, data: data.data as T, list: data.list as AffiliateListMeta | undefined, error: null, status: data?.status };
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message || 'unknown' };
  }
}

// ── Public actions (one per edge-function capability) ───────────────

export const affiliateCom = {
  ping: () => call<{ ok: boolean; sample_count?: number; total?: number | null; status: number }>('ping'),
  account: () => call<AffiliateAccount>('account'),

  networks: (args: { page?: number; per_page?: number; search?: string } = {}) =>
    call<unknown>('networks', args),
  networkGroups: (args: { page?: number; per_page?: number } = {}) =>
    call<unknown>('network_groups', args),

  listMerchants: (args: { page?: number; per_page?: number; q?: string; search?: string; network_ids?: string; has_logo?: number; product_count_min?: number } = {}) =>
    call<unknown>('list_merchants', args),
  findMerchant: (key: { id?: string | number; slug?: string; name?: string }) =>
    call<AffiliateMerchant>('find_merchant', key),

  // affiliate.com product search is a structured POST. `q` is the simple
  // path (mapped server-side to a {field:'any', operator:'LIKE'} clause);
  // pass `search` for advanced field/operator queries.
  searchProducts: (args: {
    q?: string; search?: unknown[]; page?: number; per_page?: number;
    merchant_ids?: (string | number)[]; sort_by?: string; sort_order?: 'asc' | 'desc';
  }) => call<unknown>('search_products', args),

  // Conversion tools: url-to-barcode, barcode-to-sku, sku-to-barcode,
  // asin-to-barcode, barcode-to-asin.
  convert: (args: { type: string; data?: unknown[]; value?: string; config?: unknown }) =>
    call<unknown>('convert', args),

  /** Generic allowlisted passthrough — powers the API Explorer tab. */
  raw: (args: { path: string; method?: 'GET' | 'POST'; query?: Record<string, unknown>; body?: unknown }) =>
    call<unknown>('raw', args),
};

// ── Defensive field accessors (shared by the UI tabs) ───────────────

export function merchantName(m: AffiliateMerchant): string {
  return String(m.name ?? m.slug ?? m.id ?? 'Untitled merchant');
}
export function merchantCommission(m: AffiliateMerchant): string {
  if (m.commission) return String(m.commission);
  if (m.commission_rate != null) return typeof m.commission_rate === 'number' ? `${m.commission_rate}%` : String(m.commission_rate);
  return '—';
}
export function productTitle(p: AffiliateProduct): string {
  return String(p.title ?? p.name ?? 'Untitled product');
}
export function productImage(p: AffiliateProduct): string | null {
  return (p.image_url ?? p.image ?? null) as string | null;
}
export function productLink(p: AffiliateProduct): string | null {
  return (p.affiliate_url ?? p.deep_link ?? p.url ?? null) as string | null;
}
export function productPrice(p: AffiliateProduct): string {
  const raw = p.sale_price ?? p.price;
  if (raw == null) return '—';
  const cur = p.currency ? `${p.currency} ` : '$';
  return typeof raw === 'number' ? `${cur}${raw.toFixed(2)}` : String(raw);
}

/** Pull a friendly subset of keys for a generic row table when we don't
 *  recognize the shape — keeps the explorer readable. */
export function inferColumns(rows: unknown[], max = 6): string[] {
  const seen = new Map<string, number>();
  for (const r of rows.slice(0, 20)) {
    if (r && typeof r === 'object' && !Array.isArray(r)) {
      for (const k of Object.keys(r as Record<string, unknown>)) {
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
    }
  }
  // Prefer human-meaningful keys first.
  const priority = ['id', 'name', 'title', 'merchant', 'brand', 'price', 'commission', 'status', 'category', 'date'];
  const keys = [...seen.keys()];
  keys.sort((a, b) => {
    const pa = priority.indexOf(a); const pb = priority.indexOf(b);
    if (pa !== -1 || pb !== -1) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
    return (seen.get(b) ?? 0) - (seen.get(a) ?? 0);
  });
  return keys.slice(0, max);
}

export function cellValue(row: unknown, key: string): string {
  if (!row || typeof row !== 'object') return '';
  const v = (row as Record<string, unknown>)[key];
  if (v == null) return '';
  if (typeof v === 'object') return Array.isArray(v) ? v.join(', ') : JSON.stringify(v).slice(0, 80);
  return String(v);
}
