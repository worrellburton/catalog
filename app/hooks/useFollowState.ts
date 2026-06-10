import { useEffect, useState } from 'react';
import { isFollowing as fetchIsFollowing, toggleFollow as serviceToggleFollow } from '~/services/follows';
import { getAuthUser } from '~/hooks/useAuth';
import { isGuest, requireSignup } from '~/services/guest';

/**
 * Shared cache for "is the signed-in shopper following <handle>".
 *
 * Without this, every LookCard for the same creator fires its own
 * fetch — 8 Robert Burton cards = 8 redundant auth.getUser() + 8
 * count queries. Worse, the queries race, so some cards reach
 * `following=false` and render "+ Follow" while others stay in the
 * `null` state and render nothing at all. From a shopper's point
 * of view the button appears on some tiles for the same creator
 * and not others.
 *
 * Pattern matches useBrandLogo / useShowBrandLogos:
 *   - Module-scope `cache` keyed by handle, value is the latest
 *     known follow state (or null while resolving).
 *   - Module-scope `subscribers` set, one per mounted card. The
 *     fetch fires exactly once per handle and broadcasts the
 *     result to every subscriber.
 *   - toggleFollow updates the cache atomically so every card
 *     for that handle flips together.
 */

type FollowState = boolean | null;

const cache = new Map<string, FollowState>();
const inflight = new Map<string, Promise<boolean>>();
const subscribers = new Map<string, Set<(v: FollowState) => void>>();
// Pub/sub for "any follow changed" — used by the FollowingRail in
// the header to refetch its list when a follow happens elsewhere
// (CreatorPage CTA, in-feed icon toggle). Without this the rail
// would stay frozen on its mount-time snapshot.
const listListeners = new Set<() => void>();
function notifyListChanged() {
  for (const cb of listListeners) {
    try { cb(); } catch { /* noop */ }
  }
}
export function subscribeFollowingChanges(cb: () => void): () => void {
  listListeners.add(cb);
  return () => { listListeners.delete(cb); };
}

function normalize(handle: string | null | undefined): string {
  return (handle || '').toLowerCase().trim();
}

function notify(key: string, value: FollowState) {
  const set = subscribers.get(key);
  if (!set) return;
  for (const cb of set) cb(value);
}

async function ensureFetched(key: string, raw: string): Promise<void> {
  if (cache.has(key)) return;
  let promise = inflight.get(key);
  if (!promise) {
    promise = fetchIsFollowing(raw)
      .then(v => { cache.set(key, v); notify(key, v); return v; })
      .catch(() => { cache.set(key, false); notify(key, false); return false; })
      .finally(() => { inflight.delete(key); });
    inflight.set(key, promise);
  }
  await promise;
}

/**
 * Read the cached follow state for `handle`. Returns null until the
 * shared fetch resolves; callers should treat null as "unknown, but
 * not yet a positive follow" and render the "+ Follow" affordance.
 */
export function useFollowState(handle: string | null | undefined): FollowState {
  const key = normalize(handle);
  const [state, setState] = useState<FollowState>(() => (key ? cache.get(key) ?? null : null));

  useEffect(() => {
    if (!key || !handle) return;
    if (handle.startsWith('user:')) return;
    const set = subscribers.get(key) ?? new Set<(v: FollowState) => void>();
    set.add(setState);
    subscribers.set(key, set);
    setState(cache.get(key) ?? null);
    void ensureFetched(key, handle);
    return () => {
      set.delete(setState);
      if (set.size === 0) subscribers.delete(key);
    };
  }, [key, handle]);

  return state;
}

/**
 * Toggle follow for `handle` and broadcast the new state to every
 * card subscribed to it. Throws on failure so the caller can revert
 * optimistic UI.
 */
export async function toggleFollowShared(handle: string): Promise<boolean> {
  const key = normalize(handle);
  if (!key) return false;
  // Following is a signed-in feature — a guest tap raises the signup gate
  // instead of silently no-opping. Return the current (unchanged) state.
  if (isGuest(getAuthUser())) {
    requireSignup();
    return cache.get(key) ?? false;
  }
  // Optimistic flip in the shared cache so every subscriber updates
  // immediately, then write to the DB.
  const prev = cache.get(key) ?? false;
  const optimistic = !prev;
  cache.set(key, optimistic);
  notify(key, optimistic);
  notifyListChanged();
  try {
    const { following } = await serviceToggleFollow(handle);
    cache.set(key, following);
    notify(key, following);
    notifyListChanged();
    return following;
  } catch (err) {
    cache.set(key, prev);
    notify(key, prev);
    notifyListChanged();
    throw err;
  }
}
