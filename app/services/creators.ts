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

export async function listAdminCreators(): Promise<AdminCreatorRow[]> {
  if (!supabase) return [];
  const [creatorsRes, cpRes, looksRes] = await Promise.all([
    supabase.from('creators')
      .select('handle, display_name, avatar_url, source, source_url, created_at')
      .order('created_at', { ascending: false }),
    supabase.from('creator_products').select('creator_handle'),
    supabase.from('looks').select('creator_handle').not('creator_handle', 'is', null),
  ]);
  const rows = (creatorsRes.data ?? []) as Omit<AdminCreatorRow, 'products' | 'looks'>[];

  // Counted client-side rather than with an RPC: 42 creators against a few
  // hundred junction rows is one cheap pass, and it avoids a migration whose
  // only consumer is one admin table.
  const tally = (list: { creator_handle: string | null }[] | null) => {
    const m = new Map<string, number>();
    for (const r of list ?? []) {
      if (!r.creator_handle) continue;
      m.set(r.creator_handle, (m.get(r.creator_handle) ?? 0) + 1);
    }
    return m;
  };
  const productCounts = tally(cpRes.data as { creator_handle: string | null }[] | null);
  const lookCounts = tally(looksRes.data as { creator_handle: string | null }[] | null);

  return rows.map((r) => ({
    ...r,
    products: productCounts.get(r.handle) ?? 0,
    looks: lookCounts.get(r.handle) ?? 0,
  }));
}
