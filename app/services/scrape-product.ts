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
  { name: string; created_at: string }[]
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
