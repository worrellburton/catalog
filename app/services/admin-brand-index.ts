// Brand index for the admin cmd-K search: every brand in the products table
// with its product count, loaded once per session and matched client-side.

// imports
import { supabase } from '~/utils/supabase';

// types
export interface BrandIndexEntry {
  name: string;
  count: number;
}

// constants
const PAGE = 1000;
const MAX_ROWS = 20000;

// main logic
let cache: Promise<BrandIndexEntry[]> | null = null;

async function fetchBrandIndex(): Promise<BrandIndexEntry[]> {
  if (!supabase) return [];
  const counts = new Map<string, BrandIndexEntry>();
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase.from('products').select('brand').range(from, from + PAGE - 1);
    if (error || !data) break;
    for (const row of data as Array<{ brand: string | null }>) {
      const name = (row.brand || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { name, count: 1 });
    }
    if (data.length < PAGE) break;
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

/** All brands with product counts, most products first (cached). */
export function loadBrandIndex(): Promise<BrandIndexEntry[]> {
  if (!cache) cache = fetchBrandIndex().catch(() => { cache = null; return []; });
  return cache;
}

/** Brands whose name contains the query; prefix matches first. */
export function matchBrands(index: BrandIndexEntry[], query: string, limit = 5): BrandIndexEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = index.filter(b => b.name.toLowerCase().includes(q));
  hits.sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)) || b.count - a.count);
  return hits.slice(0, limit);
}
