import { supabase } from '~/utils/supabase';
import { nonProductUrlReason } from '~/utils/productUrl';

// Modal scraper endpoint - called on retry/add so products don't wait for
// the 8am UTC daily cron. Gracefully no-ops if the env var isn't set.
const MODAL_SCRAPER_URL = import.meta.env.VITE_MODAL_SCRAPER_URL || '';

async function _triggerScrape(productId: string, url: string): Promise<void> {
  if (!MODAL_SCRAPER_URL) return;
  try {
    await fetch(MODAL_SCRAPER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: productId, url }),
    });
  } catch {
    // Non-fatal - the daily cron will pick it up
  }
}

// ============================================
// Types
// ============================================

export interface ScrapedProduct {
  url: string;
  title: string | null;
  brand: string | null;
  description: string | null;
  price: string | null;
  discounted_price: string | null;
  currency: string | null;
  images: string[];
  availability: string | null;
  scraped_at: string;
}

export interface ScrapeResult {
  success: boolean;
  data: ScrapedProduct;
  storage: {
    saved: boolean;
    path?: string;
    public_url?: string;
    error?: string;
  };
}

// ============================================
// Public API
// ============================================
//
// Product scraping is handled by the Python agent at:
//   agents/product-scraper/agent.py
//
// The agent uses Claude SDK + Playwright browser to visit pages,
// take screenshots, and extract product data. It saves JSON files
// to the 'scraped-products' Supabase storage bucket.
//
// The functions below read/manage those saved JSON files.

/**
 * List all scraped product JSON files from storage.
 */
export async function listScrapedProducts(prefix?: string): Promise<
  { name: string; created_at: string | null }[]
> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.storage
    .from('scraped-products')
    .list(prefix || 'products', { sortBy: { column: 'created_at', order: 'desc' } });

  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Download and parse a scraped product JSON from storage.
 */
export async function getScrapedProduct(path: string): Promise<ScrapedProduct> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.storage
    .from('scraped-products')
    .download(path);

  if (error) throw new Error(error.message);
  const text = await data.text();
  return JSON.parse(text) as ScrapedProduct;
}

/**
 * Delete a scraped product JSON from storage.
 */
export async function deleteScrapedProduct(path: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.storage
    .from('scraped-products')
    .remove([path]);

  if (error) throw new Error(error.message);
}

// ============================================
// Products table queries
// ============================================

export interface ProductRow {
  id: string;
  name: string | null;
  brand: string | null;
  price: string | null;
  url: string | null;
  image_url: string | null;
  images: string[];
  scrape_status: 'pending' | 'processing' | 'done' | 'failed';
  scraped_at: string | null;
  scrape_error: string | null;
  created_at: string;
}

/**
 * List all products from the products table with scrape status.
 */
export async function listProducts(options?: {
  status?: string;
  limit?: number;
  offset?: number;
  search?: string;
}): Promise<{ data: ProductRow[]; count: number }> {
  if (!supabase) return { data: [], count: 0 };

  let query = supabase
    .from('products')
    .select('id, name, brand, price, url, image_url, images, scrape_status, scraped_at, scrape_error, created_at', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (options?.status && options.status !== 'all') {
    query = query.eq('scrape_status', options.status);
  }
  if (options?.search) {
    query = query.or(`name.ilike.%${options.search}%,brand.ilike.%${options.search}%`);
  }
  if (options?.limit) {
    const from = options.offset ?? 0;
    query = query.range(from, from + options.limit - 1);
  }

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  return { data: (data || []) as ProductRow[], count: count ?? 0 };
}

/**
 * Reset a product's scrape_status back to 'pending' and immediately trigger
 * the scraper so it doesn't wait for the daily cron.
 *
 * NOTE: scraped_at is set to now() (not null) so the watchdog's
 * COALESCE(scraped_at, created_at) uses the retry time rather than the
 * original created_at, preventing the row from being immediately re-failed
 * by reconcileStuckScrapes when created_at is old.
 */
export async function retryProductScrape(productId: string): Promise<{ url: string | null; retriedAt: string }> {
  if (!supabase) throw new Error('Supabase not configured');
  const retriedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('products')
    .update({ scrape_status: 'pending', scrape_error: null, scraped_at: retriedAt })
    .eq('id', productId)
    .select('url')
    .single();
  if (error) throw new Error(error.message);
  if (data?.url) {
    await _triggerScrape(productId, data.url);
  }
  return { url: data?.url ?? null, retriedAt };
}

/**
 * Delete all products whose URL is a Google search/shopping page.
 * These were ingested before the URL pre-filter was added and can
 * never be scraped. Returns the number of rows deleted.
 */
export async function deleteGoogleUrlProducts(): Promise<number> {
  if (!supabase) throw new Error('Supabase not configured');
  const { count, error } = await supabase
    .from('products')
    .delete({ count: 'exact' })
    .ilike('url', '%google.com%');
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * Hard-delete a product row (and any associated product_creative rows via cascade).
 */
export async function deleteProduct(productId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', productId);
  if (error) throw new Error(error.message);
}

/**
 * Watchdog: flips any product stuck in scrape_status='processing' for
 * more than `staleAfterMinutes` to 'failed'. Modal containers occasionally
 * die mid-run and never write the final status. Returns the number of
 * rows reconciled. Safe to call on every panel load.
 */
export async function reconcileStuckScrapes(staleAfterMinutes = 20): Promise<number> {
  if (!supabase) return 0;
  const { data, error } = await supabase.rpc('reconcile_stuck_product_scrapes', {
    stale_after_minutes: staleAfterMinutes,
  });
  if (error) {
    // RPC may not exist yet (migration not applied) - fall back to a
    // best-effort client-side update so the panel still self-heals.
    const cutoff = new Date(Date.now() - staleAfterMinutes * 60_000).toISOString();
    const { count } = await supabase
      .from('products')
      .update({
        scrape_status: 'failed',
        scrape_error: `Auto-failed by watchdog: stuck in processing > ${staleAfterMinutes} minutes`,
        scraped_at: new Date().toISOString(),
      }, { count: 'exact' })
      .eq('scrape_status', 'processing')
      .lt('created_at', cutoff)
      .select('id');
    return count ?? 0;
  }
  return typeof data === 'number' ? data : 0;
}

/**
 * Insert a new product URL row with scrape_status='pending' and immediately
 * trigger the scraper (don't rely solely on the Supabase INSERT webhook).
 */
export async function addProductUrl(url: string): Promise<ProductRow> {
  if (!supabase) throw new Error('Supabase not configured');
  const reason = nonProductUrlReason(url);
  if (reason) throw new Error(`Refusing to add: ${reason}. Paste a direct product page URL.`);
  const { data, error } = await supabase
    .from('products')
    .insert({ url, scrape_status: 'pending', source: 'brand_url' })
    .select('id, name, brand, price, url, image_url, images, scrape_status, scraped_at, scrape_error, created_at')
    .single();
  if (error) throw new Error(error.message);
  const row = data as ProductRow;
  await _triggerScrape(row.id, url);
  return row;
}
