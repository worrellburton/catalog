import { supabase } from '~/utils/supabase';

/**
 * Per-admin MRU order for the /admin sidebar. Stored on
 * `profiles.admin_nav_order` (jsonb array of nav.to strings, most-
 * recently-visited first). Persisted across devices / sessions —
 * localStorage was the first cut but the user asked for a cloud
 * source of truth, so the source of truth is Supabase now.
 *
 * The frontend treats the column as advisory: stale entries (paths
 * that aren't in the live navItems whitelist) are filtered client-
 * side, and unknown entries fall back to the original order. Worst
 * case on a fetch failure: the sidebar renders in the static order
 * — the page still works.
 */

/** Read the current order for the signed-in admin. Returns []
 *  when not signed in or on any error so callers can fall back
 *  to the static order without a special branch. */
export async function getAdminNavOrder(): Promise<string[]> {
  if (!supabase) return [];
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData?.user?.id;
  if (!userId) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('admin_nav_order')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.warn('[admin-nav-order] read failed:', error.message);
    return [];
  }
  const raw = data?.admin_nav_order;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string');
}

/** Replace the order for the signed-in admin. Fire-and-forget —
 *  surfacing an error in the sidebar would be noise for the user.
 *  Errors are logged so we can investigate later. */
export async function saveAdminNavOrder(order: string[]): Promise<void> {
  if (!supabase) return;
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData?.user?.id;
  if (!userId) return;
  const { error } = await supabase
    .from('profiles')
    .update({ admin_nav_order: order })
    .eq('id', userId);
  if (error) {
    console.warn('[admin-nav-order] write failed:', error.message);
  }
}
