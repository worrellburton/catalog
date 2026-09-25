// On-demand link checks for the admin Data → Products Health column. Calls
// the check-product-links edge function with explicit product ids (it caps a
// call at 100); results come back per product so the table updates in place.

// imports
import { supabase } from '~/utils/supabase';

// types
export interface LinkCheckResult {
  id: string;
  url_status: number;
  url_checked_at: string;
}

// constants
/** Kept under the function's 100-id cap and well inside its run time. */
const CHUNK = 40;

// main logic
/** Re-check the given products' links. `onChunk` fires after each batch so a
 *  long bulk run can update the table progressively. */
export async function recheckProductLinks(
  ids: string[],
  onChunk?: (results: LinkCheckResult[], done: number, total: number) => void,
): Promise<{ results: LinkCheckResult[]; error: string | null }> {
  if (!supabase) return { results: [], error: 'No database' };
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const all: LinkCheckResult[] = [];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const batch = unique.slice(i, i + CHUNK);
    const { data, error } = await supabase.functions.invoke('check-product-links', { body: { ids: batch } });
    if (error) return { results: all, error: error.message };
    const results = ((data as { results?: LinkCheckResult[] } | null)?.results) ?? [];
    all.push(...results);
    onChunk?.(results, Math.min(i + CHUNK, unique.length), unique.length);
  }
  return { results: all, error: null };
}
