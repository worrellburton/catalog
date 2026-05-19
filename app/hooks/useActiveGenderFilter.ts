import { useEffect, useState } from 'react';
import {
  getShopperGender,
  subscribeToShopperGender,
} from '~/services/product-creative';

export type GenderFilter = 'all' | 'men' | 'women';

function toFilter(g: ReturnType<typeof getShopperGender>): GenderFilter {
  if (g === 'male') return 'men';
  if (g === 'female') return 'women';
  return 'all';
}

/**
 * Mirrors the module-level shopperGender singleton as a 'all'|'men'|'women'
 * filter that re-renders on changes. Lets detail-page surfaces (ProductPage,
 * LookOverlay) feed ContinuousFeed without prop-drilling activeFilter through
 * the overlay stack.
 */
export function useActiveGenderFilter(): GenderFilter {
  const [filter, setFilter] = useState<GenderFilter>(() => toFilter(getShopperGender()));
  useEffect(() => {
    return subscribeToShopperGender(g => setFilter(toFilter(g)));
  }, []);
  return filter;
}
