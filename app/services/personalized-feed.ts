// Daily Feed — consumer-side personalized ordering.
//
// Reads the daily ranked order for the signed-in shopper. The heavy lifting
// (signal gathering, holdout assignment, ranking) lives in the `personalize-
// feed` edge function, which is idempotent per user/day and persists its
// result. This module decides whether to invoke it, caches today's answer in
// localStorage, and hands the ranked ids back to the feed — BOTH the product
// order and the look order (the engine now ranks looks per shopper too; the
// feed weaves them in by feed_rank with looks leading).
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

// Bumped to v2 when looks joined the cached payload (shape changed from a bare
// product-id array to { p, l }). Bumped to v3 with the engine's daily
// lead-rotation for looks — invalidates the day's cached order so shoppers pick
// up the rotated feed immediately instead of after the next UTC rollover.
const CACHE_PREFIX = 'catalog:personalized-feed:v3';

/** UTC day stamp (YYYY-MM-DD) — matches the edge function's per-day key. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// The cache key folds in the global "advance" epoch so an admin bumping it
// (advanceDailyFeed) instantly invalidates every shopper's cached order — the
// next render re-invokes and gets the advanced feed, no UTC-rollover wait.
function cacheKey(userId: string, epoch: number): string {
  return `${CACHE_PREFIX}:${userId}:${todayUtc()}:e${epoch}`;
}

/** Read today's cached order, or null when there's no entry for today. An
 *  entry with both arrays empty means "already invoked, nothing to
 *  personalize" — still returned (callers treat empty as "no personalization"
 *  per-lane) so we don't re-hit the edge function. */
function readCache(userId: string, epoch: number): PersonalizedOrders | null {
  try {
    const raw = localStorage.getItem(cacheKey(userId, epoch));
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.p) && Array.isArray(parsed.l)) {
      return { products: parsed.p as string[], looks: parsed.l as string[] };
    }
    return null;
  } catch {
    return null;
  }
}

function writeCache(userId: string, epoch: number, o: PersonalizedOrders): void {
  try {
    localStorage.setItem(cacheKey(userId, epoch), JSON.stringify({ p: o.products, l: o.looks }));
  } catch {
    /* localStorage full / unavailable — fine, we just re-invoke later */
  }
}

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

  // Today's answer is sticky in localStorage (keyed by the advance epoch too).
  const cached = readCache(user.id, config.epoch);
  if (cached) return (cached.products.length || cached.looks.length) ? cached : null;

  const { data, error } = await supabase.functions.invoke<PersonalizeFeedResponse>(
    'personalize-feed',
    { body: {} },
  );
  if (error || !data) {
    return null;
  }

  if (data.variant === 'personalized' && Array.isArray(data.ranked_items) && data.ranked_items.length > 0) {
    const products: string[] = [];
    const looks: string[] = [];
    for (const item of data.ranked_items) {
      if (!item || typeof item.id !== 'string') continue;
      if (item.type === 'look') looks.push(item.id);
      else if (item.type === 'product') products.push(item.id);
    }
    if (products.length > 0 || looks.length > 0) {
      const orders = { products, looks };
      writeCache(user.id, config.epoch, orders);
      return orders;
    }
  }

  // Any non-personalized variant (fallback / holdout / disabled) or an empty
  // ranking: cache empties for today so we don't re-invoke, return null.
  writeCache(user.id, config.epoch, { products: [], looks: [] });
  return null;
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

/** Purge every cached personalized order (all days + epochs) and drop any
 *  in-flight compute so the next getPersonalizedOrders() re-invokes the edge
 *  function fresh. The cache key already folds in the epoch, but an already-open
 *  session holds React state + a warm cache for the OLD epoch — when an admin
 *  advances the feed we clear both and re-pull. */
export function clearPersonalizedCache(): void {
  inFlight = null;
  if (typeof window === 'undefined') return;
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) stale.push(k);
    }
    for (const k of stale) localStorage.removeItem(k);
  } catch { /* localStorage unavailable — fine, the next compute re-fetches */ }
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
