import { supabase } from '~/utils/supabase';

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
  scrape_status: 'pending' | 'processing' | 'done' | 'failed';
  scraped_at: string | null;
  scrape_error: string | null;
  is_active: boolean;
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
    .select('id, name, brand, price, url, image_url, scrape_status, scraped_at, scrape_error, is_active, created_at', { count: 'exact' })
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
 * Reset a product's scrape_status back to 'pending' so the agent picks it up again.
 */
export async function retryProductScrape(productId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('products')
    .update({ scrape_status: 'pending', scrape_error: null, scraped_at: null })
    .eq('id', productId);
  if (error) throw new Error(error.message);
}
