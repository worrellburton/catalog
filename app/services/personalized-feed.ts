// Automatic Editor — consumer-side personalized feed ordering.
//
// Reads the daily ranked product order for the signed-in shopper. The
// heavy lifting (signal gathering, holdout assignment, ranking) lives in
// the `personalize-feed` edge function, which is idempotent per user/day
// and persists its result. This module just decides whether to invoke it,
// caches today's answer in localStorage, and hands the product-id order
// back to the feed.
//
// Fail-open everywhere: any error, a disabled dial, a holdout/fallback
// variant, or a guest session all resolve to null so the consumer feed
// keeps its existing global feed_rank order.

import { supabase } from '~/utils/supabase';
import { getAutoEditorConfig } from './dials';

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

const CACHE_PREFIX = 'catalog:personalized-feed:v1';

/** UTC day stamp (YYYY-MM-DD) — matches the edge function's per-day key. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function cacheKey(userId: string): string {
  return `${CACHE_PREFIX}:${userId}:${todayUtc()}`;
}

/** Read today's cached order. Returns an array (possibly empty, meaning
 *  "we already invoked and there's nothing to personalize") or null when
 *  there is no cache entry for today. */
function readCache(userId: string): string[] | null {
  try {
    const raw = localStorage.getItem(cacheKey(userId));
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

function writeCache(userId: string, ids: string[]): void {
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify(ids));
  } catch {
    /* localStorage full / unavailable — fine, we just re-invoke later */
  }
}

// Coalesce concurrent callers onto one in-flight promise so a burst of
// feed renders during boot doesn't fire multiple edge-function invokes.
let inFlight: Promise<string[] | null> | null = null;

async function compute(): Promise<string[] | null> {
  if (typeof window === 'undefined' || !supabase) return null;

  // Only meaningful for a signed-in shopper.
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return null;

  // Master dial gate — when the Automatic Editor is off, never touch the feed.
  const config = await getAutoEditorConfig();
  if (!config.enabled) return null;

  // Today's answer is sticky in localStorage (empty array = "already
  // invoked, not personalized" so we don't re-hit the edge function).
  const cached = readCache(user.id);
  if (cached) return cached.length > 0 ? cached : null;

  const { data, error } = await supabase.functions.invoke<PersonalizeFeedResponse>(
    'personalize-feed',
    { body: {} },
  );
  if (error || !data) {
    return null;
  }

  if (data.variant === 'personalized' && Array.isArray(data.ranked_items) && data.ranked_items.length > 0) {
    const ids = data.ranked_items
      .filter(item => item && item.type === 'product' && typeof item.id === 'string')
      .map(item => item.id);
    if (ids.length > 0) {
      writeCache(user.id, ids);
      return ids;
    }
  }

  // Any non-personalized variant (fallback / holdout / disabled) or an empty
  // ranking: cache an empty array for today so we don't re-invoke, return null.
  writeCache(user.id, []);
  return null;
}

/**
 * Resolve today's personalized product-id order for the signed-in shopper,
 * or null when personalization shouldn't apply (dial off, guest, holdout,
 * fallback, or any error). Never throws. Coalesces concurrent callers.
 */
export function getPersonalizedProductOrder(): Promise<string[] | null> {
  if (inFlight) return inFlight;
  inFlight = compute()
    .catch(() => null)
    .finally(() => { inFlight = null; });
  return inFlight;
}
