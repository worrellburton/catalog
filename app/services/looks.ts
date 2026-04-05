import { supabase } from '~/utils/supabase';
import type { Look, Product, Creator } from '~/data/looks';
import { looks as staticLooks, creators as staticCreators, searchSuggestions as staticSuggestions } from '~/data/looks';

// Flag to toggle between Supabase and static data
// Set to true once Supabase tables are populated
const USE_SUPABASE = true;

// ============================================
// Supabase fetchers
// ============================================

interface SupabaseLook {
  id: string;
  legacy_id: number;
  title: string;
  video_path: string;
  gender: 'men' | 'women';
  creator_handle: string;
  description: string;
  color: string;
  look_products: {
    sort_order: number;
    products: {
      name: string;
      brand: string;
      price: string;
      url: string;
      image_url: string;
    };
  }[];
}

async function fetchLooksFromSupabase(): Promise<Look[]> {
  if (!supabase) return staticLooks;
  const { data, error } = await supabase
    .from('looks')
    .select(`
      id,
      legacy_id,
      title,
      video_path,
      gender,
      creator_handle,
      description,
      color,
      look_products (
        sort_order,
        products (
          name,
          brand,
          price,
          url,
          image_url
        )
      )
    `)
    .order('legacy_id');

  if (error || !data) {
    console.warn('Supabase looks fetch failed, falling back to static:', error?.message);
    return staticLooks;
  }

  return (data as SupabaseLook[]).map((row) => ({
    id: row.legacy_id,
    title: row.title,
    video: row.video_path,
    gender: row.gender,
    creator: row.creator_handle,
    description: row.description || '',
    color: row.color || '#888',
    products: (row.look_products || [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((lp) => ({
        name: lp.products.name,
        brand: lp.products.brand || '',
        price: lp.products.price || '',
        url: lp.products.url || '',
        image: lp.products.image_url,
      })),
  }));
}

async function fetchCreatorsFromSupabase(): Promise<Record<string, Creator>> {
  if (!supabase) return staticCreators;
  const { data, error } = await supabase
    .from('creators')
    .select('handle, display_name, avatar_url');

  if (error || !data) {
    console.warn('Supabase creators fetch failed, falling back to static:', error?.message);
    return staticCreators;
  }

  const map: Record<string, Creator> = {};
  for (const row of data) {
    map[row.handle] = {
      name: row.handle,
      displayName: row.display_name,
      avatar: row.avatar_url || '',
    };
  }
  return map;
}

async function fetchSearchSuggestionsFromSupabase(): Promise<string[]> {
  if (!supabase) return staticSuggestions;
  const { data, error } = await supabase
    .from('search_suggestions')
    .select('text')
    .order('sort_order');

  if (error || !data) {
    return staticSuggestions;
  }

  return data.map((row) => row.text);
}

// ============================================
// Public API — returns static or Supabase data
// ============================================

export async function getLooks(): Promise<Look[]> {
  if (!USE_SUPABASE) return staticLooks;
  return fetchLooksFromSupabase();
}

export async function getCreators(): Promise<Record<string, Creator>> {
  if (!USE_SUPABASE) return staticCreators;
  return fetchCreatorsFromSupabase();
}

export async function getSearchSuggestions(): Promise<string[]> {
  if (!USE_SUPABASE) return staticSuggestions;
  return fetchSearchSuggestionsFromSupabase();
}
