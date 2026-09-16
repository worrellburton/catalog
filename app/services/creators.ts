// Admin creator list. Replaces the hardcoded mock arrays that
// app/routes/admin/creators.tsx shipped with.

import { supabase } from '~/utils/supabase';

export interface AdminCreatorRow {
  handle: string;
  display_name: string;
  avatar_url: string | null;
  source: string | null;
  source_url: string | null;
  created_at: string | null;
  products: number;
  looks: number;
}

export interface AdminCreatorsResult {
  rows: AdminCreatorRow[];
  error: string | null;
}

export async function listAdminCreators(): Promise<AdminCreatorsResult> {
  if (!supabase) return { rows: [], error: null };
  const [creatorsRes, statsRes] = await Promise.all([
    supabase.from('creators')
      .select('handle, display_name, avatar_url, source, source_url, created_at')
      .order('created_at', { ascending: false }),
    supabase.rpc('admin_creator_stats'),
  ]);

  // The creators query is the one that must be trusted: a failure here means
  // we have no rows to show, and "No creators yet." would lie about a real
  // read failure (RLS/auth) looking identical to a genuinely empty table.
  if (creatorsRes.error) {
    return { rows: [], error: creatorsRes.error.message };
  }
  const rows = (creatorsRes.data ?? []) as Omit<AdminCreatorRow, 'products' | 'looks'>[];

  // Counts come from a grouped RPC (not a client-side tally over raw junction
  // rows) because PostgREST caps a response at 1000 rows and this feature
  // imports ~425 products per ShopMy creator - a client-side tally silently
  // under-counts past the third imported creator. A stats failure degrades
  // to zero counts rather than hiding the list.
  const stats = (statsRes.data ?? []) as { creator_handle: string; products: number; looks: number }[];
  const statsByHandle = new Map(stats.map((s) => [s.creator_handle, s]));

  return {
    rows: rows.map((r) => ({
      ...r,
      products: statsByHandle.get(r.handle)?.products ?? 0,
      looks: statsByHandle.get(r.handle)?.looks ?? 0,
    })),
    error: null,
  };
}
