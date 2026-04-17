import { useReducer, useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { looks as allLooks, type Look, type Product } from '~/data/looks';
import { getSimilarLooks } from '~/utils/similarity';
import FeedSection from './FeedSection';
import InlineLookDetail from './InlineLookDetail';
import { getLiveAds, type ProductAd } from '~/services/product-ads';

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
  | { type: 'OPEN_LOOK'; look: Look }
  | { type: 'RESET'; looks: Look[] };

function feedReducer(state: FeedState, action: FeedAction): FeedState {
  switch (action.type) {
    case 'OPEN_LOOK': {
      const { look } = action;
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
        seenLookIds: new Set(),
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
  onCreateCatalog,
  bookmarks,
}: ContinuousFeedProps) {
  const filteredLooks = useMemo(() => {
    let filtered = activeFilter === 'all' ? allLooks : allLooks.filter(l => l.gender === activeFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(l =>
        l.title.toLowerCase().includes(q) ||
        l.creator.toLowerCase().includes(q) ||
        l.description.toLowerCase().includes(q) ||
        l.products.some(p => p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q))
      );
    }
    return filtered;
  }, [activeFilter, searchQuery]);

  const [state, dispatch] = useReducer(feedReducer, {
    segments: [{ type: 'feed', id: 'initial', looks: filteredLooks, isInitial: true }],
    seenLookIds: new Set(),
  });

  // Fetch live ads from Supabase
  const [liveAds, setLiveAds] = useState<ProductAd[]>([]);
  useEffect(() => {
    console.log('[ContinuousFeed] fetching live ads...');
    getLiveAds()
      .then(ads => {
        console.log('[ContinuousFeed] received ads:', ads.length, ads.map(a => ({ id: a.id, video_url: a.video_url?.substring(0, 60), status: a.status, enabled: a.enabled })));
        setLiveAds(ads);
      })
      .catch(err => {
        console.error('[ContinuousFeed] getLiveAds failed:', err);
      });
  }, []);

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
      dispatch({ type: 'OPEN_LOOK', look });
    }
  }, [onOpenLookProp]);

  const handleOpenAdProduct = useCallback((ad: ProductAd) => {
    const url = ad.affiliate_url || ad.product?.url;
    if (url) {
      onOpenBrowser(url, ad.product?.name || 'Shop');
    }
  }, [onOpenBrowser]);

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
              onOpenAdProduct={handleOpenAdProduct}
              ads={segment.isInitial ? liveAds : undefined}
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
