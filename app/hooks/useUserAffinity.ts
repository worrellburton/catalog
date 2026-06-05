// useUserAffinity — reactive wrapper over the affinity signal. Reads the
// shopper's recent products (via useRecentProducts) and recent searches, then
// recomputes the category affinity whenever either changes. Consumed by
// ContinuousFeed (feed re-rank) and useDynamicSectionTitle (section naming).

import { useEffect, useMemo, useState } from 'react';
import { useRecentProducts } from '~/hooks/useRecentProducts';
import { getRecentSearches, RECENT_SEARCH_EVENT } from '~/services/recent-searches';
import { computeAffinity, type UserAffinity } from '~/services/user-affinity';

export function useUserAffinity(): UserAffinity {
  const { recentProducts } = useRecentProducts();
  const [searches, setSearches] = useState<string[]>(() => getRecentSearches());

  // Refresh searches on same-tab writes (custom event) and cross-tab writes
  // (native storage event). recentProducts already updates reactively.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => setSearches(getRecentSearches());
    window.addEventListener(RECENT_SEARCH_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(RECENT_SEARCH_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  return useMemo(() => computeAffinity(recentProducts, searches), [recentProducts, searches]);
}
