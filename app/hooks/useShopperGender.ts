import { useCallback, useEffect, useRef, useState } from 'react';
import { setShopperGender } from '~/services/product-creative';
import { getUserGender } from '~/services/genders';
import type { useAuth } from '~/hooks/useAuth';

export type GenderFilter = 'all' | 'men' | 'women';

type AuthUser = ReturnType<typeof useAuth>['user'];

interface UseShopperGenderArgs {
  user: AuthUser;
  authLoading: boolean;
}

interface UseShopperGenderResult {
  activeFilter: GenderFilter;
  // Stable handler: locks the user-override flag, updates the local
  // filter, and tells the product-creative service so brand-strip /
  // similar-rail queries re-scope.
  changeFilter: (next: GenderFilter) => void;
  // Mark the filter as user-overridden without changing its value.
  // Used by handleOpenBrand so the brand-search override isn't later
  // clobbered by the profile-gender auto-sync.
  lockOverride: () => void;
  // Reset to 'all' without locking override. Used by reset paths
  // (logo click, shell category navigation) where 'all' is the
  // intended fresh state.
  resetFilter: () => void;
}

// Owns the gender filter state and the auto-sync from the signed-in
// user's profile gender. Manual taps via changeFilter() set the
// user-override flag so the auto-sync never clobbers an explicit choice.
//
// Mapping into the module-level shopperGender (used by every
// product-creative query):
//   'men'   → 'male'
//   'women' → 'female'
//   'all'   → 'unknown' (no filter)
//
// Without this, flipping the Shopping-for toggle to Women only
// re-scoped the looks (small portion of the feed) - the much larger
// creative grid kept rendering whatever the profile's signup gender was.
export function useShopperGender({ user, authLoading }: UseShopperGenderArgs): UseShopperGenderResult {
  const [activeFilter, setActiveFilter] = useState<GenderFilter>('all');
  const filterUserOverride = useRef(false);

  const changeFilter = useCallback((next: GenderFilter) => {
    filterUserOverride.current = true;
    setActiveFilter(next);
    setShopperGender(next === 'men' ? 'male' : next === 'women' ? 'female' : 'unknown');
  }, []);

  const lockOverride = useCallback(() => {
    filterUserOverride.current = true;
  }, []);

  const resetFilter = useCallback(() => {
    setActiveFilter('all');
  }, []);

  // Auto-scope the feed by the shopper's profile gender so a guy lands
  // on men + unisex looks, a girl on women + unisex. Runs once per
  // session-bound user id; skipped if the user has manually overridden.
  useEffect(() => {
    if (!user || authLoading) return;
    if (filterUserOverride.current) return;
    let cancelled = false;
    getUserGender(user.id).then(g => {
      if (cancelled) return;
      // Always tell product-creative the gender so brand-strip and
      // live-ads queries scope correctly, even when the looks-level
      // filter is overridden. Skip 'unknown' - that's the null-state
      // and we never want to hide the catalog from someone we can't tag.
      if (g === 'male' || g === 'female') setShopperGender(g);
      if (filterUserOverride.current) return;
      if (g === 'male') setActiveFilter('men');
      else if (g === 'female') setActiveFilter('women');
      // 'unknown' leaves the catalog wide-open ('all').
    });
    return () => { cancelled = true; };
  }, [user, authLoading]);

  return { activeFilter, changeFilter, lockOverride, resetFilter };
}
