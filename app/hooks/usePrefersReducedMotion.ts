import { useSyncExternalStore } from 'react';

// Shared matchMedia subscription so hundreds of feed cards don't each
// construct their own MediaQueryList. One listener, many subscribers.
const QUERY = '(prefers-reduced-motion: reduce)';

let mql: MediaQueryList | null = null;
function getMql(): MediaQueryList | null {
  if (typeof window === 'undefined' || !window.matchMedia) return null;
  if (!mql) mql = window.matchMedia(QUERY);
  return mql;
}

function subscribe(onChange: () => void): () => void {
  const m = getMql();
  if (!m) return () => {};
  m.addEventListener('change', onChange);
  return () => m.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  return getMql()?.matches ?? false;
}

/**
 * True when the OS-level "reduce motion" setting is on. Feed cards use it
 * to prefer the still-image path over autoplaying video whenever a still
 * exists (cards with no still at all keep video — a blank tile is worse
 * for everyone than a quiet clip).
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
