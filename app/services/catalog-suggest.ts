// Client wrapper for the catalog-suggest edge function — turns a search term +
// the shopper's demographics into 2-3 fun catalog names shown at the end of the
// search ceremony. Always resolves (never throws): on any failure it returns []
// so the ceremony just reveals the raw results.

import { supabase } from '~/utils/supabase';

export async function suggestCatalogs(
  term: string,
  opts: { gender?: string | null; age?: string | null } = {},
): Promise<string[]> {
  if (!supabase || !term.trim()) return [];
  try {
    const { data, error } = await supabase.functions.invoke('catalog-suggest', {
      body: { term: term.trim(), gender: opts.gender ?? '', age: opts.age ?? '' },
    });
    if (error) return [];
    const catalogs = (data as { catalogs?: unknown })?.catalogs;
    if (!Array.isArray(catalogs)) return [];
    return catalogs.map(String).map(s => s.trim()).filter(Boolean).slice(0, 3);
  } catch {
    return [];
  }
}
