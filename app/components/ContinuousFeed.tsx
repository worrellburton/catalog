import { useReducer, useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { looks as staticLooksRaw, type Look, type Product } from '~/data/looks';
import { getLooks } from '~/services/looks';
import { getSimilarLooks } from '~/utils/similarity';
import FeedSection from './FeedSection';
import InlineLookDetail from './InlineLookDetail';
import { getLiveAds, getCatalogCreatives, deleteProductAd, type ProductAd } from '~/services/product-ads';
import { supabase } from '~/utils/supabase';
import { useAuth } from '~/hooks/useAuth';
import { useHiddenLooks, useHiddenProductKeys } from '~/hooks/useHiddenLooks';

interface BookmarksInterface {
  isLookBookmarked: (id: number) => boolean;
  toggleLookBookmark: (id: number) => void;
  isProductBookmarked: (p: Product) => boolean;
  toggleProductBookmark: (p: Product) => void;
}

interface ContinuousFeedProps {
  activeFilter: 'all' | 'men' | 'women';
  searchQuery: string;
  shuffleKey: number;
  layoutMode: number;
  onOpenLook?: (look: Look) => void;
  onOpenCreator: (name: string) => void;
  onOpenBrowser: (url: string, title: string) => void;
  onOpenProduct?: (product: Product) => void;
  onOpenCreative?: (creative: ProductAd) => void;
  onCreateCatalog?: (query: string) => void;
  bookmarks: BookmarksInterface;
}

type Segment =
  | { type: 'feed'; id: string; looks: Look[]; title?: string; isInitial?: boolean }
  | { type: 'detail'; id: string; look: Look };

type FeedState = {
  segments: Segment[];
  seenLookIds: Set<number>;
};

type FeedAction =
  | { type: 'OPEN_LOOK'; look: Look; allLooks: Look[] }
  | { type: 'RESET'; looks: Look[] };

function feedReducer(state: FeedState, action: FeedAction): FeedState {
  switch (action.type) {
    case 'OPEN_LOOK': {
      const { look, allLooks } = action;
      const newSeen = new Set(state.seenLookIds);
      newSeen.add(look.id);

      const related = getSimilarLooks(look, allLooks, 8, newSeen);
      related.forEach(l => newSeen.add(l.id));

      return {
        segments: [
          ...state.segments,
          { type: 'detail', id: `detail-${look.id}-${Date.now()}`, look },
          { type: 'feed', id: `feed-${look.id}-${Date.now()}`, looks: related, title: 'More like this' },
        ],
        seenLookIds: newSeen,
      };
    }
    case 'RESET':
      return {
        segments: [
          { type: 'feed', id: `initial-${Date.now()}`, looks: action.looks, isInitial: true },
        ],
        seenLookIds: new Set<number>(),
      };
    default:
      return state;
  }
}

export default function ContinuousFeed({
  activeFilter,
  searchQuery,
  shuffleKey,
  layoutMode,
  onOpenLook: onOpenLookProp,
  onOpenCreator,
  onOpenBrowser,
  onOpenProduct,
  onOpenCreative,
  onCreateCatalog,
  bookmarks,
}: ContinuousFeedProps) {
  // Respect admin deletes: looks/products hidden via the Content admin panel
  // must never appear in the consumer feed, detail pages, or similar-look rows.
  const hiddenLookIds = useHiddenLooks();
  const hiddenProductKeys = useHiddenProductKeys();

  // Load looks live from Supabase so the feed mirrors whatever the admin's
  // Content tab shows. Static seed is only used as a fallback while the
  // fetch is in flight or if Supabase is unreachable.
  const [dbLooks, setDbLooks] = useState<Look[]>(staticLooksRaw);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fetched = await getLooks();
        if (!cancelled && fetched.length > 0) setDbLooks(fetched);
      } catch {
        // keep static fallback
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const allLooks = useMemo(() => {
    return dbLooks
      .filter(l => !hiddenLookIds.has(l.id))
      .map(l => ({
        ...l,
        products: l.products.filter(p => !hiddenProductKeys.has(`${p.brand}-${p.name}`)),
      }));
  }, [dbLooks, hiddenLookIds, hiddenProductKeys]);

  const filteredLooks = useMemo(() => {
    const base = activeFilter === 'all' ? allLooks : allLooks.filter(l => l.gender === activeFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      // Strict match. We used to fall back to the full look set when no look
      // matched the query so the grid wasn't blank — but that leaks unrelated
      // looks into catalog-scoped searches (e.g. "white shoes" surfacing a
      // random creator). If no look matches, show none and let the creative
      // grid carry the search result.
      return base.filter(l =>
        l.title.toLowerCase().includes(q) ||
        l.creator.toLowerCase().includes(q) ||
        l.description.toLowerCase().includes(q) ||
        l.products.some(p => p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q))
      );
    }
    return base;
  }, [activeFilter, searchQuery, allLooks]);

  const [state, dispatch] = useReducer(feedReducer, {
    segments: [{ type: 'feed', id: 'initial', looks: filteredLooks, isInitial: true }],
    seenLookIds: new Set<number>(),
  });

  // Fetch live product creative from Supabase. We surface a loading flag so
  // the feed can render placeholder tiles in creative slots until the fetch
  // resolves — otherwise the grid renders pure looks for a beat and the
  // same two faces fill the first screen.
  const [liveCreatives, setLiveCreatives] = useState<ProductAd[]>([]);
  const [creativesLoading, setCreativesLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    getLiveAds()
      .then(data => {
        if (cancelled) return;
        setLiveCreatives(data);
      })
      .catch(err => {
        console.error('[ContinuousFeed] fetching creative failed:', err);
      })
      .finally(() => {
        if (!cancelled) setCreativesLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // When the user searches, look up the full catalog (status IN
  // ('done','live')) so the feed lands on every creative the admin has
  // curated for that catalog — not just the elite/live subset `getLiveAds()`
  // returns. Null = no query; [] = queried but no match; ProductAd[] = hit.
  const [catalogCreatives, setCatalogCreatives] = useState<ProductAd[] | null>(null);
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setCatalogCreatives(null);
      return;
    }
    let cancelled = false;
    getCatalogCreatives(q)
      .then(data => { if (!cancelled) setCatalogCreatives(data); })
      .catch(err => {
        console.error('[ContinuousFeed] catalog creative fetch failed:', err);
        if (!cancelled) setCatalogCreatives([]);
      });
    return () => { cancelled = true; };
  }, [searchQuery]);

  // Filter creatives by the current search. If the query matches a catalog
  // (products tagged with the search term), use the full catalog set fetched
  // above. Otherwise fall back to a text match on product name / brand /
  // catalog_tags against the elite live ads.
  const filteredCreatives = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return liveCreatives;

    if (catalogCreatives && catalogCreatives.length > 0) {
      return catalogCreatives.filter(ad => !hiddenProductKeys.has(
        `${ad.product?.brand || ''}-${ad.product?.name || ''}`,
      ));
    }

    const matches = liveCreatives.filter(c =>
      (c.product?.name || '').toLowerCase().includes(q) ||
      (c.product?.brand || '').toLowerCase().includes(q) ||
      (c.product?.catalog_tags || []).some(t => t.toLowerCase().includes(q)),
    );
    // Empty match = user typed a theme we don't have; fall back to everything
    // rather than showing a blank grid.
    return matches.length > 0 ? matches : liveCreatives;
  }, [liveCreatives, catalogCreatives, searchQuery, hiddenProductKeys]);

  // Log search queries to Supabase (debounced)
  const { user } = useAuth();
  const lastLoggedQueryRef = useRef<string>('');
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || q.length < 2 || q === lastLoggedQueryRef.current) return;
    lastLoggedQueryRef.current = q;
    const timer = setTimeout(() => {
      if (!supabase) return;
      const handle = user?.displayName || user?.email || localStorage.getItem('catalog_user_handle') || (() => {
        const h = `user_${Math.random().toString(36).slice(2, 8)}`;
        localStorage.setItem('catalog_user_handle', h);
        return h;
      })();
      supabase.from('search_logs').insert({
        query: q,
        user_handle: handle,
        results_count: filteredLooks.length,
        clicked: false,
        filter: activeFilter,
      }).then(({ error }) => {
        if (error) console.error('[search_logs] insert failed:', error.message);
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [searchQuery, filteredLooks.length, activeFilter, user]);

  // Reset when filters/search/shuffle change
  const prevFilterRef = useRef({ activeFilter, searchQuery, shuffleKey });
  useEffect(() => {
    const prev = prevFilterRef.current;
    if (
      prev.activeFilter !== activeFilter ||
      prev.searchQuery !== searchQuery ||
      prev.shuffleKey !== shuffleKey
    ) {
      dispatch({ type: 'RESET', looks: filteredLooks });
      prevFilterRef.current = { activeFilter, searchQuery, shuffleKey };
    }
  }, [activeFilter, searchQuery, shuffleKey, filteredLooks]);

  // Scroll to newly added detail
  const lastDetailRef = useRef<HTMLDivElement>(null);
  const prevSegmentCount = useRef(state.segments.length);
  useEffect(() => {
    if (state.segments.length > prevSegmentCount.current && lastDetailRef.current) {
      // Small delay to ensure DOM is painted before scrolling
      requestAnimationFrame(() => {
        lastDetailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    prevSegmentCount.current = state.segments.length;
  }, [state.segments.length]);

  const handleOpenLook = useCallback((look: Look) => {
    if (onOpenLookProp) {
      onOpenLookProp(look);
    } else {
      dispatch({ type: 'OPEN_LOOK', look, allLooks });
    }
  }, [onOpenLookProp, allLooks]);

  const canDeleteCreative = user?.role === 'admin';

  const handleDeleteCreative = useCallback(async (id: string) => {
    // Optimistic remove so the tile disappears immediately; reinstate on error.
    setLiveCreatives(prev => prev.filter(c => c.id !== id));
    const { error } = await deleteProductAd(id);
    if (error) {
      console.error('[ContinuousFeed] deleteProductAd failed:', error);
      alert(`Could not delete creative: ${error}`);
      // Best-effort restore via a fresh fetch.
      getLiveAds().then(setLiveCreatives).catch(() => {});
    }
  }, []);

  const handleOpenCreativeProduct = useCallback((creative: ProductAd) => {
    if (onOpenCreative) {
      onOpenCreative(creative);
      return;
    }
    // Fallback (shouldn't happen in normal consumer use): open the affiliate.
    const url = creative.affiliate_url || creative.product?.url;
    if (url) {
      onOpenBrowser(url, creative.product?.name || 'Shop');
    }
  }, [onOpenBrowser, onOpenCreative]);

  // Find the last detail segment index for ref assignment
  const lastDetailIdx = useMemo(() => {
    for (let i = state.segments.length - 1; i >= 0; i--) {
      if (state.segments[i].type === 'detail') return i;
    }
    return -1;
  }, [state.segments]);

  return (
    <div className="continuous-feed" id="grid-viewport">
      {state.segments.map((segment, idx) => {
        if (segment.type === 'feed') {
          return (
            <FeedSection
              key={segment.id}
              looks={segment.looks}
              onOpenLook={handleOpenLook}
              onOpenCreator={onOpenCreator}
              onCreateCatalog={onCreateCatalog}
              onOpenCreativeProduct={handleOpenCreativeProduct}
              creatives={segment.isInitial ? filteredCreatives : undefined}
              creativesLoading={segment.isInitial ? creativesLoading : false}
              canDeleteCreative={canDeleteCreative}
              onDeleteCreative={handleDeleteCreative}
              title={segment.title}
              isInitial={segment.isInitial}
              layoutMode={layoutMode}
            />
          );
        }
        return (
          <div
            key={segment.id}
            ref={idx === lastDetailIdx ? lastDetailRef : undefined}
          >
            <InlineLookDetail
              look={segment.look}
              onOpenCreator={onOpenCreator}
              onOpenBrowser={onOpenBrowser}
              onOpenProduct={onOpenProduct}
              onCreateCatalog={onCreateCatalog}
              bookmarks={bookmarks}
            />
          </div>
        );
      })}
    </div>
  );
}
