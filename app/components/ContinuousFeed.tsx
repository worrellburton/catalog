import { useReducer, useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { looks as staticLooksFallback, type Look, type Product } from '~/data/looks';
import { getLooks } from '~/services/looks';
import { getSimilarLooks } from '~/utils/similarity';
import FeedSection from './FeedSection';
import InlineLookDetail from './InlineLookDetail';
import EmptyCatalogState from './EmptyCatalogState';
import { prefetchLiveAds, getLiveAds, deleteProductAd, getCreativesByProductIds, type ProductAd } from '~/services/product-creative';
import { primeTrailAssets } from '~/utils/trailPrefetch';
import { supabase } from '~/utils/supabase';
import { logSearch } from '~/services/search-log';
import { useAuth } from '~/hooks/useAuth';
import { useHiddenLooks, useHiddenProductKeys } from '~/hooks/useHiddenLooks';
import { useSemanticSearch } from '~/hooks/useSemanticSearch';

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

  // Load looks live from Supabase. Initial state is empty so we don't burn
  // a render pass filtering the seed dataset (and don't briefly leak its
  // 2-creator content into the "More like this" rails on slow networks).
  // The first segment is creative-only anyway, so an empty looks array
  // costs nothing on first paint — sub-segments only matter after the
  // user taps a look, by which point Supabase has resolved.
  const [dbLooks, setDbLooks] = useState<Look[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fetched = await getLooks();
        if (!cancelled && fetched.length > 0) setDbLooks(fetched);
      } catch {
        // Supabase unreachable — fall back to the static seed so sub-segments
        // have *something* to draw similars from instead of an empty rail.
        if (!cancelled) setDbLooks(staticLooksFallback);
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

  // ── Semantic search ────────────────────────────────────────────────────────
  // Kicks in for queries ≥ 3 chars; reorders filteredLooks so semantically
  // ranked looks float to the top. Falls back to the local text filter when
  // the edge function is unavailable or the query is too short.
  const genderOpt = activeFilter === 'all' ? undefined : activeFilter;
  const semantic = useSemanticSearch(searchQuery, { gender: genderOpt });

  // Reorder filteredLooks: semantic matches first (in rank order), rest after.
  const semanticallyOrderedLooks = useMemo(() => {
    const ids = semantic.lookIds;
    if (ids.length === 0) return filteredLooks;

    // Build UUID → Look map for fast lookup
    const uuidMap = new Map<string, Look>();
    for (const l of filteredLooks) {
      if (l.uuid) uuidMap.set(l.uuid, l);
    }

    // Also try to supplement with looks from allLooks (not in filteredLooks
    // because they were filtered out by text match — but semantic overrides
    // the text filter).
    const allUuidMap = new Map<string, Look>();
    for (const l of allLooks) {
      if (l.uuid) allUuidMap.set(l.uuid, l);
    }

    const matched: Look[] = [];
    const matchedSet = new Set<number>();
    for (const id of ids) {
      const look = uuidMap.get(id) ?? allUuidMap.get(id);
      if (look && !matchedSet.has(look.id)) {
        matched.push(look);
        matchedSet.add(look.id);
      }
    }

    // Append any filteredLooks not already in the semantic results
    const rest = filteredLooks.filter(l => !matchedSet.has(l.id));
    return [...matched, ...rest];
  }, [semantic.lookIds, filteredLooks, allLooks]);

  const [state, dispatch] = useReducer(feedReducer, {
    segments: [{ type: 'feed', id: 'initial', looks: semanticallyOrderedLooks, isInitial: true }],
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
    // prefetchLiveAds returns the cached Promise primed by LandingPage if the
    // user came in through the marketing flow; otherwise it kicks off a fresh
    // fetch. Either way we also prime asset caches (idempotent) so direct
    // deep-links don't pay the shimmer-to-pop cost.
    prefetchLiveAds()
      .then(data => {
        if (cancelled) return;
        setLiveCreatives(data);
        primeTrailAssets(data);
      })
      .catch(err => {
        console.error('[ContinuousFeed] fetching creative failed:', err);
      })
      .finally(() => {
        if (!cancelled) setCreativesLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Fetch product_creative entries for semantic search products that aren't
  // already in the elite rotation. The semantic lane returns product UUIDs
  // ranked by relevance — we hydrate each into a CreativeCard with its real
  // video so the search grid matches the feed visually (no static thumbnails).
  const [semanticCreatives, setSemanticCreatives] = useState<ProductAd[]>([]);
  useEffect(() => {
    let cancelled = false;
    const ids = semantic.products.map(p => p.id);
    if (ids.length === 0) {
      setSemanticCreatives([]);
      return;
    }
    getCreativesByProductIds(ids)
      .then(rows => {
        if (cancelled) return;
        setSemanticCreatives(rows);
        primeTrailAssets(rows);
      })
      .catch(err => console.warn('[ContinuousFeed] semantic creatives fetch failed:', err));
    return () => { cancelled = true; };
  }, [semantic.products]);

  // Filter creatives by the current search. If any product in the library has
  // catalog_tags that match the query (case-insensitive), treat the search as
  // a catalog lookup and keep only creatives whose product is tagged with it.
  // Otherwise fall back to a text match on product name / brand.
  const filteredCreatives = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return liveCreatives;

    const isCatalogMatch = liveCreatives.some(c =>
      (c.product?.catalog_tags || []).some(t => t.toLowerCase() === q),
    );

    if (isCatalogMatch) {
      return liveCreatives.filter(c =>
        (c.product?.catalog_tags || []).some(t => t.toLowerCase() === q),
      );
    }

    const matches = liveCreatives.filter(c =>
      (c.product?.name || '').toLowerCase().includes(q) ||
      (c.product?.brand || '').toLowerCase().includes(q) ||
      (c.product?.catalog_tags || []).some(t => t.toLowerCase().includes(q)),
    );
    // Empty match = user typed a theme we don't have; fall back to everything
    // rather than showing a blank grid.
    return matches.length > 0 ? matches : liveCreatives;
  }, [liveCreatives, searchQuery]);

  // When the semantic lane returned product hits, surface them at the top of
  // the creative grid in rank order, then dedupe the rest of filteredCreatives
  // so the same product can't appear twice. Falls through to filteredCreatives
  // unchanged when there are no semantic product matches.
  const semanticallyOrderedCreatives = useMemo<ProductAd[]>(() => {
    if (semanticCreatives.length === 0) return filteredCreatives;
    const seen = new Set<string>();
    const out: ProductAd[] = [];
    for (const c of semanticCreatives) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    for (const c of filteredCreatives) {
      if (seen.has(c.id)) continue;
      // Also dedupe by product_id so we don't show two videos for the same
      // product (semantic hit + elite rotation entry for the same product).
      const productId = c.product_id;
      if (productId && out.some(x => x.product_id === productId)) continue;
      seen.add(c.id);
      out.push(c);
    }
    return out;
  }, [semanticCreatives, filteredCreatives]);

  // Log search queries through the batch endpoint. Debounced 1.5 s and
  // prefix-deduped so mid-typing keystrokes don't each enqueue an entry;
  // the queue itself flushes every 5 s or on tab close, so a user's
  // session of pauses lands as one POST.
  const { user } = useAuth();
  const lastLoggedQueryRef = useRef<string>('');
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || q.length < 2) return;
    const last = lastLoggedQueryRef.current;
    if (q === last || last.startsWith(q)) return;
    const timer = setTimeout(() => {
      lastLoggedQueryRef.current = q;
      const handle = user?.displayName || user?.email || localStorage.getItem('catalog_user_handle') || (() => {
        const h = `user_${Math.random().toString(36).slice(2, 8)}`;
        localStorage.setItem('catalog_user_handle', h);
        return h;
      })();
      logSearch({
        query: q,
        user_handle: handle,
        results_count: semanticallyOrderedLooks.length,
        clicked: false,
        filter: activeFilter,
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [searchQuery, semanticallyOrderedLooks.length, activeFilter, user]);

  // Reset when filters/search/shuffle change
  const prevFilterRef = useRef({ activeFilter, searchQuery, shuffleKey });
  useEffect(() => {
    const prev = prevFilterRef.current;
    if (
      prev.activeFilter !== activeFilter ||
      prev.searchQuery !== searchQuery ||
      prev.shuffleKey !== shuffleKey
    ) {
      dispatch({ type: 'RESET', looks: semanticallyOrderedLooks });
      prevFilterRef.current = { activeFilter, searchQuery, shuffleKey };
    }
  }, [activeFilter, searchQuery, shuffleKey, semanticallyOrderedLooks]);

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

  // Delete-on-feed is destructive on a public surface — gate strictly to
  // super-admins. Regular admins keep edit access on /admin pages but won't
  // see the trash affordance directly on the consumer grid.
  const canDeleteCreative = user?.role === 'super_admin';

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

  // Empty-catalog state: shopper searched something we have nothing for.
  // We only show this once the initial fetch has resolved (don't flash an
  // empty state during the brief mount-to-data window) and only when the
  // search bar has actual user intent in it (so unfiltered "all" never lands
  // here, even on a brand-new install with zero data).
  //
  // When the semantic search is still in-flight (loading=true) or returned a
  // cold-miss, we show the empty state with a "sourcing" flag so the copy
  // reads "We're finding this for you" rather than "nothing here yet".
  const trimmedQuery = searchQuery.trim();
  const semanticActive = trimmedQuery.length >= 3;
  const showEmptyState =
    !creativesLoading &&
    !semantic.loading &&
    trimmedQuery.length > 0 &&
    semanticallyOrderedCreatives.length === 0 &&
    semanticallyOrderedLooks.length === 0;

  // While semantic search is loading (only for long-enough queries), show the
  // sourcing state immediately so the user sees feedback during the round-trip.
  const showSourcingState =
    !showEmptyState &&
    semanticActive &&
    semantic.loading &&
    semanticallyOrderedCreatives.length === 0 &&
    filteredLooks.length === 0;

  if (showEmptyState || showSourcingState) {
    return (
      <EmptyCatalogState
        catalogName={trimmedQuery}
        isSourcing={showSourcingState || (showEmptyState && semantic.coldMiss)}
      />
    );
  }

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
              creatives={segment.isInitial ? semanticallyOrderedCreatives : undefined}
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
