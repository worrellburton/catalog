// Per-user "seen" tracking for the consumer feed.
//
// The feed follows the catalog's order, but we hide thumbnails a shopper
// has already seen (logged an impression for) on a previous visit — and
// once they've seen everything, we reset and show them again. Seen state
// lives in user_events (impressions), surfaced via the user_seen_keys
// RPC (scoped to auth.uid()). Anonymous shoppers have no seen set, so
// they always see the full feed.

import { supabase } from '~/utils/supabase';

export type SeenKey = string; // `${'look'|'product'}:${id}`

/** Fetch the set of look/product keys the current user has already seen.
 *  Empty set for guests or on any error (fail-open: never hide the feed
 *  because the seen lookup hiccuped). */
export async function getSeenKeys(): Promise<Set<SeenKey>> {
  if (!supabase) return new Set();
  try {
    // Only meaningful for an authenticated shopper — skip the round trip
    // for guests (auth.uid() would be null → empty anyway).
    const { data: sess } = await supabase.auth.getSession();
    if (!sess?.session?.user) return new Set();
    const { data, error } = await supabase.rpc('user_seen_keys');
    if (error || !data) return new Set();
    const out = new Set<SeenKey>();
    for (const r of data as { target_type: string; target_key: string }[]) {
      if (r.target_type && r.target_key) out.add(`${r.target_type}:${r.target_key}`);
    }
    return out;
  } catch {
    return new Set();
  }
}

/** Minimum feed length below which we stop hiding seen items and show
 *  everything (the "you've seen it all → show again" reset, triggered a
 *  little early so a returning power-user never lands on a near-empty
 *  feed). */
export const SEEN_FEED_MIN_UNSEEN = 12;

/**
 * Split a list into [unseen, seen] using the seen-key set + a key
 * extractor. If hiding seen would leave fewer than SEEN_FEED_MIN_UNSEEN
 * items, returns the full list unchanged (reset cycle).
 */
export function partitionUnseen<T>(
  items: T[],
  seen: Set<SeenKey>,
  keyOf: (item: T) => SeenKey | null,
): T[] {
  if (seen.size === 0) return items;
  const unseen: T[] = [];
  const seenItems: T[] = [];
  for (const it of items) {
    const k = keyOf(it);
    if (k && seen.has(k)) seenItems.push(it);
    else unseen.push(it);
  }
  // Everything seen, or nearly so → reset: show the full list in order.
  if (unseen.length < SEEN_FEED_MIN_UNSEEN) return items;
  return unseen;
}
