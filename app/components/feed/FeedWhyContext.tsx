// Carries the live feed-composition snapshot to the per-card super-admin
// "why did this show up?" buttons WITHOUT threading props through the
// memoized FeedSection (which would defeat its render-skipping). The
// provider value is stable — consumers only read it lazily on click, so
// nothing re-renders when the snapshot updates.

import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react';
import type { FeedWhyContextData } from '~/services/feed-why';

interface WhyAccess {
  /** Latest snapshot, read on demand (returns null when not provided). */
  get: () => FeedWhyContextData | null;
}

const Ctx = createContext<WhyAccess>({ get: () => null });

export function FeedWhyProvider({ value, children }: { value: FeedWhyContextData | null; children: ReactNode }) {
  const ref = useRef<FeedWhyContextData | null>(value);
  ref.current = value; // latest-read; safe to mutate a ref during render
  // Stable accessor → context consumers never re-render on snapshot change.
  const access = useMemo<WhyAccess>(() => ({ get: () => ref.current }), []);
  return <Ctx.Provider value={access}>{children}</Ctx.Provider>;
}

export const useFeedWhyAccess = () => useContext(Ctx);
