// Cloud sync for the shopper's saved collections (services/saved-layout.ts).
//
// Collections are authored locally (localStorage) on the Saved screen. For
// signed-in users we mirror them to `creator_collections` so they roam across
// devices AND surface publicly on the creator's catalog Shop tab. Reads are
// public; writes are owner-only (enforced by RLS).

import { supabase } from '~/utils/supabase';
import type { SavedCollection } from './saved-layout';

export interface CreatorCollection {
  clientId: string;
  name: string;
  productKeys: string[];
  lookIds: number[];
  sortOrder: number;
}

interface CollectionRow {
  client_id: string;
  name: string;
  product_keys: string[] | null;
  look_ids: number[] | null;
  sort_order: number | null;
}

/** Public read — a creator's collections, ordered as they arranged them. */
export async function getCreatorCollections(userId: string): Promise<CreatorCollection[]> {
  if (!supabase || !userId) return [];
  const { data, error } = await supabase
    .from('creator_collections')
    .select('client_id, name, product_keys, look_ids, sort_order')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true });
  if (error || !data) return [];
  return (data as CollectionRow[]).map(r => ({
    clientId: r.client_id,
    name: r.name,
    productKeys: r.product_keys ?? [],
    lookIds: r.look_ids ?? [],
    sortOrder: r.sort_order ?? 0,
  }));
}

/**
 * Mirror the local collections to the cloud (owner-only). Upserts every
 * current collection by (user_id, client_id) — carrying the local sort order —
 * then prunes rows whose client_id no longer exists locally. Best-effort:
 * callers fire-and-forget so a network hiccup never blocks the UI.
 */
export async function syncCreatorCollections(
  userId: string,
  collections: SavedCollection[],
): Promise<void> {
  if (!supabase || !userId) return;

  if (collections.length > 0) {
    const rows = collections.map((c, i) => ({
      user_id: userId,
      client_id: c.id,
      name: c.name,
      product_keys: c.productKeys,
      look_ids: c.lookIds,
      sort_order: i,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from('creator_collections')
      .upsert(rows, { onConflict: 'user_id,client_id' });
    if (error) return; // bail before pruning if the upsert failed
  }

  // Prune collections deleted locally. client_ids are generated from a safe
  // charset (col_<base36>_<base36>), so inlining them in the filter is safe.
  const keepIds = collections.map(c => c.id);
  let del = supabase.from('creator_collections').delete().eq('user_id', userId);
  if (keepIds.length > 0) {
    del = del.not('client_id', 'in', `(${keepIds.map(id => `"${id}"`).join(',')})`);
  }
  await del;
}
