// Daily Feed — consumer-side personalized ordering.
//
// Reads the daily ranked order for the signed-in shopper. The heavy lifting
// (signal gathering, holdout assignment, ranking) lives in the `personalize-
// feed` edge function, which is idempotent per user/day and persists its
// result. This module decides whether to invoke it, caches today's answer
// IN MEMORY for the current page session (NOT localStorage — see below), and
// hands the ranked ids back to the feed — BOTH the product order and the look
// order (the engine now ranks looks per shopper too; the feed weaves them in by
// feed_rank with looks leading). Because the cache is session memory, every
// reload re-validates the order against the engine (which is cheap: the engine
// returns the same idempotent row unless the day or epoch changed), so the feed
// can never get stuck on a stale order.
//
// Fail-open everywhere: any error, a disabled dial, a holdout/fallback
// variant, or a guest session all resolve to null so the consumer feed keeps
// its existing global feed_rank order.

import { supabase } from '~/utils/supabase';
import { getAutoEditorConfig, AUTO_EDITOR_EPOCH_KEY } from './dials';

interface RankedItem {
  type: string;
  id: string;
}

interface PersonalizeFeedResponse {
  success: boolean;
  enabled: boolean;
  variant: 'personalized' | 'fallback' | 'holdout' | 'disabled';
  ranked_items: RankedItem[];
  cached: boolean;
}

/** Today's per-shopper order, split by item type. */
export interface PersonalizedOrders {
  products: string[];
  looks: string[];
}

// Persisted feed-order caching was REMOVED. A localStorage entry keyed by
// (user, UTC-day, epoch) made the order sticky for the whole day, so a shopper
// who loaded once — or briefly landed in the holdout — was locked to that order
// until the next UTC rollover, even after an admin advanced the feed or flipped
// a dial. That was the "feed never changes" bug. The order is now cached only
// IN MEMORY for the current page session (below): re-renders within one load
// reuse it (a single edge call), but every reload re-validates the current
// order, and nothing is written to the user's storage. PERSIST_PREFIX is kept
// only so the boot sweep (pruneStalePersistedOrders) can purge entries any
// older build left behind.
const PERSIST_PREFIX = 'catalog:personalized-feed:';

// Client-side mirror of the edge function's editorDay(refreshHour, epoch).
// Keyed by refreshHour so the session cache invalidates automatically when
// the daily rollover passes — critical for the Flutter WebView where the page
// is never reloaded on app-resume (unlike mobile Safari which purges tabs).
function editorDay(refreshHour: number): string {
  return new Date(Date.now() - refreshHour * 3_600_000).toISOString().slice(0, 10);
}

// In-memory, session-scoped order cache, keyed by epoch + editor day.
// Clears when: admin advances (epoch changes), day rolls over at refreshHour,
// or the module is reloaded (full page load). Any of those re-pulls fresh.
let sessionOrders: { epoch: number; date: string; value: PersonalizedOrders | null } | null = null;

// Coalesce concurrent callers onto one in-flight promise so a burst of feed
// renders during boot doesn't fire multiple edge-function invokes.
let inFlight: Promise<PersonalizedOrders | null> | null = null;

async function compute(): Promise<PersonalizedOrders | null> {
  if (typeof window === 'undefined' || !supabase) return null;

  // Only meaningful for a signed-in shopper.
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return null;

  // Master dial gate — when the Daily Feed is off, never touch the feed.
  const config = await getAutoEditorConfig();
  if (!config.enabled) return null;

  // Reuse this session's order when epoch + editor day both match. Epoch changes
  // on admin advance; date changes at refreshHour — either invalidates the cache.
  const today = editorDay(config.refreshHour);
  if (sessionOrders && sessionOrders.epoch === config.epoch && sessionOrders.date === today) {
    const v = sessionOrders.value;
    return v && (v.products.length || v.looks.length) ? v : null;
  }

  const { data, error } = await supabase.functions.invoke<PersonalizeFeedResponse>(
    'personalize-feed',
    { body: {} },
  );
  if (error || !data) {
    return null;
  }

  let orders: PersonalizedOrders | null = null;
  if (data.variant === 'personalized' && Array.isArray(data.ranked_items) && data.ranked_items.length > 0) {
    const products: string[] = [];
    const looks: string[] = [];
    for (const item of data.ranked_items) {
      if (!item || typeof item.id !== 'string') continue;
      if (item.type === 'look') looks.push(item.id);
      else if (item.type === 'product') products.push(item.id);
    }
    if (products.length > 0 || looks.length > 0) orders = { products, looks };
  }

  // Remember for the rest of THIS page session (cleared on reload / advance / rollover).
  sessionOrders = { epoch: config.epoch, date: today, value: orders };
  return orders;
}

/**
 * Resolve today's personalized order (products + looks) for the signed-in
 * shopper, or null when personalization shouldn't apply. Never throws.
 * Coalesces concurrent callers.
 */
export function getPersonalizedOrders(): Promise<PersonalizedOrders | null> {
  if (inFlight) return inFlight;
  inFlight = compute()
    .catch(() => null)
    .finally(() => { inFlight = null; });
  return inFlight;
}

/** Today's personalized PRODUCT id order, or null. */
export function getPersonalizedProductOrder(): Promise<string[] | null> {
  return getPersonalizedOrders().then(o => (o && o.products.length > 0 ? o.products : null));
}

/** Today's personalized LOOK uuid order, or null. */
export function getPersonalizedLookOrder(): Promise<string[] | null> {
  return getPersonalizedOrders().then(o => (o && o.looks.length > 0 ? o.looks : null));
}

/** Drop the in-memory session order + any in-flight compute so the next
 *  getPersonalizedOrders() re-pulls fresh from the engine. Called on a live
 *  Advance (realtime) and safe to call anytime. Also sweeps any persisted
 *  feed-order entries left by older builds (this module no longer writes them)
 *  so they don't linger in the shopper's storage. */
export function clearPersonalizedCache(): void {
  sessionOrders = null;
  inFlight = null;
  pruneStalePersistedOrders();
}

/** Remove every `catalog:personalized-feed:*` key (any version) from
 *  localStorage. We no longer persist the order, so these are always stale —
 *  this reclaims the space older builds used and is run once on boot. */
export function pruneStalePersistedOrders(): void {
  if (typeof window === 'undefined') return;
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PERSIST_PREFIX)) stale.push(k);
    }
    for (const k of stale) localStorage.removeItem(k);
  } catch { /* localStorage unavailable — nothing to reclaim */ }
}

/** Live "Advance" hook. Fires `onAdvance` whenever the global Daily Feed epoch
 *  changes (admin clicked "Advance to next daily feed") so an open feed can
 *  re-roll immediately instead of waiting for a reload or the UTC rollover —
 *  this is what makes the admin dialog's "re-rolls everyone's order
 *  immediately" actually true for live sessions. Returns an unsubscribe fn;
 *  no-op when realtime/Supabase isn't available. */
export function subscribeFeedAdvance(onAdvance: () => void): () => void {
  if (typeof window === 'undefined' || !supabase) return () => {};
  const channel = supabase
    .channel('daily-feed-advance')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'app_settings', filter: `key=eq.${AUTO_EDITOR_EPOCH_KEY}` },
      () => onAdvance(),
    )
    .subscribe();
  return () => { try { supabase.removeChannel(channel); } catch { /* ignore */ } };
}
