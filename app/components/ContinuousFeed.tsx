import { useReducer, useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { looks as staticLooksFallback, type Look, type Product } from '~/data/looks';
import { getLooks } from '~/services/looks';
import { getSimilarLooks } from '~/utils/similarity';
import FeedSection from './FeedSection';
import InlineLookDetail from './InlineLookDetail';
import EmptyCatalogState from './EmptyCatalogState';
import { prefetchHomeFeed, getCachedHomeFeed, getHomeFeed, getCreativesByCatalogTag, getCreativesByBrandQuery, resolveBrandFromQuerySync, creativeMatchesCatalogQuery, resolveCatalogTypes, resolveMaterialKeywords, deleteProductAd, deleteProduct, subscribeToShopperGender, type ProductAd } from '~/services/product-creative';
import { primeTrailAssets } from '~/utils/trailPrefetch';
import { supabase } from '~/utils/supabase';
import { logSearch } from '~/services/search-log';
import { useAuth } from '~/hooks/useAuth';
import { useHiddenLooks, useHiddenProductKeys } from '~/hooks/useHiddenLooks';
import { useDeleteMode } from '~/hooks/useDeleteMode';
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
  onOpenBrand?: (brandName: string) => void;
  onCreateCatalog?: (query: string) => void;
  bookmarks: BookmarksInterface;
  /** Called with true when nl-search is in-flight, false when resolved. */
  onSearchLoadingChange?: (loading: boolean) => void;
  /** Incremented on each Enter/submit to bypass debounce and fire immediately. */
  searchTrigger?: number;
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
  onOpenBrand,
  onCreateCatalog,
  bookmarks,
  onSearchLoadingChange,
  searchTrigger = 0,
}: ContinuousFeedProps) {
  // ── Committed query - the feed only updates when nl-search resolves ─────
  // While the user is typing (or nl-search is in flight), committedQuery stays
  // at the last resolved value so the grid doesn't jump on every keystroke.
  // For short queries (< 3 chars, no semantic call) we commit immediately.
  // Tier-1 (catalog_tags) hits also commit immediately - see tagMatchedCreatives.
  const [committedQuery, setCommittedQuery] = useState('');
  const wasLoadingRef = useRef(false);

  // Short / empty queries: commit immediately (no semantic search fires).
  // Tier-1 eligible queries (catalog types like "shoes") also commit
  // immediately - we know nl-search is disabled for them and the tag
  // fast-path will populate results within ~10 ms.
  useEffect(() => {
    if (
      searchQuery.trim().length < 3 ||
      !!resolveCatalogTypes(searchQuery) ||
      !!resolveBrandFromQuerySync(searchQuery)
    ) {
      setCommittedQuery(searchQuery);
    }
  }, [searchQuery]);

  // ── Filtering uses committedQuery so grid doesn't change while typing ──
  // must never appear in the consumer feed, detail pages, or similar-look rows.
  const hiddenLookIds = useHiddenLooks();
  const hiddenProductKeys = useHiddenProductKeys();

  // Load looks live from Supabase. Initial state is empty so we don't burn
  // a render pass filtering the seed dataset (and don't briefly leak its
  // 2-creator content into the "More like this" rails on slow networks).
  // The first segment is creative-only anyway, so an empty looks array
  // costs nothing on first paint - sub-segments only matter after the
  // user taps a look, by which point Supabase has resolved.
  const [dbLooks, setDbLooks] = useState<Look[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fetched = await getLooks();
        if (!cancelled && fetched.length > 0) setDbLooks(fetched);
      } catch {
        // Supabase unreachable - fall back to the static seed so sub-segments
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
    // Gender filter: 'men' includes 'unisex' looks too (and vice-versa)
    // so catalog-wide staples surface for everyone regardless of the
    // shopper's profile gender.
    const base = activeFilter === 'all'
      ? allLooks
      : allLooks.filter(l => l.gender === activeFilter || l.gender === 'unisex');
    if (committedQuery) {
      const q = committedQuery.toLowerCase();
      // For searches >= 3 chars (semantic-eligible), suppress looks entirely.
      // The look text filter (title/description/product name .includes()) is
      // too broad - a look with "tennis shoes" in its title or a skirt product
      // named "tennis skirt" would appear for a "shoes" search. The semantic
      // lane (renderedCreatives) already surfaces the right products; mixing
      // looks in via text match adds noise.
      if (q.length >= 3) return [];
      return base.filter(l =>
        l.title.toLowerCase().includes(q) ||
        l.creator.toLowerCase().includes(q) ||
        l.description.toLowerCase().includes(q) ||
        l.products.some(p => p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q))
      );
    }
    return base;
  }, [activeFilter, committedQuery, allLooks]);

  // ── Semantic search ────────────────────────────────────────────────────────
  // Kicks in for queries ≥ 3 chars; reorders filteredLooks so semantically
  // ranked looks float to the top. Falls back to the local text filter when
  // the edge function is unavailable or the query is too short.
  const genderOpt = activeFilter === 'all' ? undefined : activeFilter;
  // Tier-1 eligibility: if the query maps to a known catalog type (e.g.
  // "shoes", "pants"), the in-memory + DB tag fast-path renders first.
  // We still run semantic in the background so Haiku-driven expansion can
  // broaden / refine results, but we suppress the pending/loading UX so
  // the UI stays instant for these common queries.
  const tier1Eligible = !!resolveCatalogTypes(searchQuery);
  // Always run nl-search so Haiku gets to expand every query against the
  // canonical product.type set. Cache hits are ~80ms; misses ~400ms with
  // Haiku+embed running in parallel. Tier-1 still wins the first paint.
  const semantic = useSemanticSearch(searchQuery, { gender: genderOpt, trigger: searchTrigger, enabled: true });

  // Semantic queries: commit on the loading true → false transition.
  // wasLoadingRef tracks the previous value so we only commit on the
  // falling edge, not on every render while idle.
  useEffect(() => {
    const justFinished = wasLoadingRef.current && !semantic.loading;
    wasLoadingRef.current = semantic.loading;
    if (justFinished) {
      setCommittedQuery(searchQuery);
    }
  });

  // Notify parent of pending search state so it can show a spinner in the
  // search bar. "Pending" = user typed something long enough for semantic
  // but results haven't arrived yet.
  const isSearchPending = !tier1Eligible && searchQuery.trim().length >= 3 && (
    searchQuery !== committedQuery || semantic.loading
  );
  useEffect(() => {
    onSearchLoadingChange?.(isSearchPending);
  }, [isSearchPending, onSearchLoadingChange]);

  // Clean up spinner on unmount
  useEffect(() => () => onSearchLoadingChange?.(false), [onSearchLoadingChange]);

  // Reorder filteredLooks: with creative-first search, look ordering is no
  // longer driven by semantic results (creatives are inserted into the feed
  // separately). Pass filteredLooks through unchanged.
  const semanticallyOrderedLooks = useMemo(() => filteredLooks, [filteredLooks]);

  const [state, dispatch] = useReducer(feedReducer, {
    segments: [{ type: 'feed', id: 'initial', looks: semanticallyOrderedLooks, isInitial: true }],
    seenLookIds: new Set<number>(),
  });

  // Fetch live product creative from Supabase. We surface a loading flag so
  // the feed can render placeholder tiles in creative slots until the fetch
  // resolves - otherwise the grid renders pure looks for a beat and the
  // same two faces fill the first screen.
  // Stale-while-revalidate first paint: if there's a localStorage snapshot
  // from a prior visit, hydrate state with it synchronously so the feed
  // renders in the first React commit instead of after the network round
  // trip. Network revalidation kicks off in parallel and overwrites state
  // when it lands.
  const initialCached = useMemo(() => getCachedHomeFeed(), []);
  const [liveCreatives, setLiveCreatives] = useState<ProductAd[]>(initialCached || []);
  const [creativesLoading, setCreativesLoading] = useState(!initialCached);
  useEffect(() => {
    let cancelled = false;
    if (initialCached) primeTrailAssets(initialCached);

    const refetch = () => {
      // Gender-aware re-fetch. Called once on mount and again whenever
      // setShopperGender fires - without this, a male/female user sees
      // the unfiltered cached feed forever because module-load
      // prefetchHomeFeed() ran with shopperGender='unknown' before auth
      // resolved. setShopperGender invalidates homeFeedPromise so this
      // call always hits a fresh fetch with the current scope.
      prefetchHomeFeed()
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
    };

    refetch();
    const unsubscribe = subscribeToShopperGender(refetch);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [initialCached]);

  // ── Tier-1: catalog_tags fast path ───────────────────────────────────────
  // When the user types a query that matches an existing catalog (e.g.
  // "shoes", "chairs"), render those results synchronously and commit the
  // query immediately so the grid reflows without waiting on nl-search.
  //
  // Three lookup tiers (cheapest → most expensive):
  //   0. Session LRU (Map<query, ProductAd[]>)         ~0 ms,  no network
  //   1. In-memory liveCreatives (already loaded)      ~0 ms,  no network
  //   2. DB catalog_tag query (getCreativesByCatalogTag) ~10 ms, one round-trip
  //
  // Misses fall through to the existing nl-search semantic path, which keeps
  // its current loading/sourcing UX.
  const tagCacheRef = useRef<Map<string, ProductAd[]>>(new Map());
  const TAG_LRU_MAX = 50;
  const [tagMatchedCreatives, setTagMatchedCreatives] = useState<ProductAd[]>([]);
  const tagQueryRef = useRef<string>('');

  // Brand fast-path. When the query is an exact brand name (case- and
  // whitespace-insensitive), render only that brand's creatives and skip
  // the semantic pipeline entirely - the user's intent is unambiguous.
  const brandCacheRef = useRef<Map<string, ProductAd[]>>(new Map());
  const BRAND_LRU_MAX = 50;
  const [brandMatchedCreatives, setBrandMatchedCreatives] = useState<ProductAd[]>([]);
  const brandQueryRef = useRef<string>('');

  useEffect(() => {
    const raw = searchQuery.trim();
    if (!raw) {
      brandQueryRef.current = '';
      setBrandMatchedCreatives([]);
      return;
    }
    const q = raw.toLowerCase();

    const cached = brandCacheRef.current.get(q);
    if (cached) {
      brandQueryRef.current = q;
      setBrandMatchedCreatives(cached);
      setCommittedQuery(searchQuery);
      return;
    }

    let cancelled = false;
    (async () => {
      const rows = await getCreativesByBrandQuery(raw);
      if (cancelled || searchQuery.trim().toLowerCase() !== q) return;
      if (rows && rows.length > 0) {
        brandQueryRef.current = q;
        brandCacheRef.current.set(q, rows);
        if (brandCacheRef.current.size > BRAND_LRU_MAX) {
          const oldest = brandCacheRef.current.keys().next().value;
          if (oldest !== undefined) brandCacheRef.current.delete(oldest);
        }
        setBrandMatchedCreatives(rows);
        setCommittedQuery(searchQuery);
      } else if (brandQueryRef.current === q) {
        // Query changed away from a previous brand match - clear.
        brandQueryRef.current = '';
        setBrandMatchedCreatives([]);
      } else {
        brandQueryRef.current = '';
        setBrandMatchedCreatives([]);
      }
    })();
    return () => { cancelled = true; };
  }, [searchQuery]);

  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      tagQueryRef.current = '';
      setTagMatchedCreatives([]);
      return;
    }

    // 0. Session LRU
    const cached = tagCacheRef.current.get(q);
    if (cached) {
      tagQueryRef.current = q;
      setTagMatchedCreatives(cached);
      setCommittedQuery(searchQuery);
      return;
    }

    // 1. In-memory match against already-loaded liveCreatives.
    const inMemory = liveCreatives.filter(c => creativeMatchesCatalogQuery(c, q));
    if (inMemory.length > 0) {
      tagQueryRef.current = q;
      setTagMatchedCreatives(inMemory);
      setCommittedQuery(searchQuery);
      // Top up from DB asynchronously - the in-memory pool is the elite
      // subset, so the full catalog usually has more rows behind it.
      let cancelled = false;
      getCreativesByCatalogTag(q).then(rows => {
        if (cancelled || tagQueryRef.current !== q) return;
        if (rows.length > inMemory.length) {
          setTagMatchedCreatives(rows);
          tagCacheRef.current.set(q, rows);
          // LRU eviction - Map preserves insertion order, so the oldest
          // entry is the first key.
          if (tagCacheRef.current.size > TAG_LRU_MAX) {
            const oldest = tagCacheRef.current.keys().next().value;
            if (oldest !== undefined) tagCacheRef.current.delete(oldest);
          }
        } else {
          tagCacheRef.current.set(q, inMemory);
        }
      }).catch(() => {});
      return () => { cancelled = true; };
    }

    // 2. DB lookup - only when we haven't already committed via in-memory.
    let cancelled = false;
    (async () => {
      const rows = await getCreativesByCatalogTag(q);
      if (cancelled || searchQuery.trim().toLowerCase() !== q) return;
      if (rows.length > 0) {
        tagQueryRef.current = q;
        tagCacheRef.current.set(q, rows);
        if (tagCacheRef.current.size > TAG_LRU_MAX) {
          const oldest = tagCacheRef.current.keys().next().value;
          if (oldest !== undefined) tagCacheRef.current.delete(oldest);
        }
        setTagMatchedCreatives(rows);
        setCommittedQuery(searchQuery);
      } else {
        // Cold miss for the tag path - clear so we don't show stale results
        // while the semantic path resolves.
        if (tagQueryRef.current === q) {
          // No-op: keep prior tag matches if the query is still in flight.
        }
        tagQueryRef.current = q;
        setTagMatchedCreatives([]);
      }
    })();
    return () => { cancelled = true; };
  }, [searchQuery, liveCreatives]);

  // Map semantic creatives (returned directly by nl-search) into ProductAd
  // shape for CreativeCard rendering. nl-search now indexes product_creative
  // directly via search_creatives_hybrid, so each result row already carries
  // the joined product fields - no client-side hydration through
  // products/look_products needed.
  //
  // NOTE: we intentionally do NOT merge filteredCreatives into
  // semanticallyOrderedCreatives when nl-search returns results. filteredCreatives
  // uses a substring catalog_tags match (e.g. "tennis shoes" → matches "shoes")
  // which is much broader than nl-search's canonical type filter, causing
  // unrelated products (skirts, dresses) to appear after the correct results land.
  const semanticCreatives = useMemo<ProductAd[]>(() => {
    if (!semantic.creatives.length) return [];
    // Material gate: for queries like "denim"/"leather"/"wool" the server
    // products fallback returns all rows of the resolved type (Pants, Jacket)
    // without checking the material keyword. Apply the same name-contains
    // filter we use in the tier-1 path so semantic results don't leak
    // off-material items (e.g. ALO running shorts under "denim").
    const materialKws = resolveMaterialKeywords(committedQuery);
    const matchesMaterial = (name: string | null | undefined): boolean => {
      if (!materialKws) return true;
      const n = (name || '').toLowerCase();
      return materialKws.some(kw => n.includes(kw));
    };
    // SEARCH_V3: keep placeholder (image-only) rows so cold categories
    // surface real products instead of an empty grid. CreativeCard handles
    // the missing video_url by rendering the product image.
    return semantic.creatives
      .filter(c => matchesMaterial(c.product_name))
      .map(c => ({
      id:               c.id,
      product_id:       c.product_id,
      look_id:          null,
      title:            null,
      description:      null,
      video_url:        c.video_url,
      storage_path:     null,
      thumbnail_url:    c.thumbnail_url,
      affiliate_url:    c.affiliate_url,
      prompt:           null,
      prompt_extra:     null,
      style:            'semantic',
      model:            null,
      status:           'live' as const,
      duration_seconds: c.duration_seconds,
      aspect_ratio:     null,
      resolution:       null,
      cost_usd:         null,
      impressions:      0,
      clicks:           0,
      error:            null,
      enabled:          true,
      is_elite:         c.is_elite ?? false,
      created_at:       new Date().toISOString(),
      completed_at:     null,
      updated_at:       null,
      product: {
        id:           c.product_id,
        name:         c.product_name,
        brand:        c.product_brand,
        price:        c.product_price,
        image_url:    c.product_image_url,
        url:          c.product_url,
        catalog_tags: null,
      },
    }));
  }, [semantic.creatives, committedQuery]);

  useEffect(() => {
    if (semanticCreatives.length) primeTrailAssets(semanticCreatives);
  }, [semanticCreatives]);

  // Filter creatives by the current search.
  // When a search query is active (≥ 3 chars), return [] so the grid is driven
  // entirely by the semantic pipeline (tagMatchedCreatives + semanticCreatives).
  // Text / substring matching on catalog_tags or product names is too noisy  - 
  // e.g. a skirt tagged "tennis shoes" would match a "shoes" search. Returning
  // [] here forces the caller to rely on the ranker, not the keyword filter.
  // filteredCreatives is only used as-is for the default browse state (no query
  // or short prefix < 3 chars) where we display the full live pool.
  const filteredCreatives = useMemo(() => {
    const q = committedQuery.trim().toLowerCase();
    // Live (uncommitted) query - used to suppress the elite fallback the
    // moment the user starts typing a semantic-eligible query, so the grid
    // doesn't flash with unrelated creatives while nl-search is in flight.
    const liveQ = searchQuery.trim().toLowerCase();
    if (liveQ.length >= 3 && liveQ !== q) {
      // Semantic search is pending - show nothing from the text/elite lane.
      // semanticallyOrderedCreatives + the sourcing state below take over.
      return [];
    }
    if (!q) return liveCreatives;
    // For any active search (≥ 3 chars), let tagMatch + semantic handle results.
    // Never fall back to text/substring matching - it produces false positives.
    if (q.length >= 3) return [];
    return liveCreatives;
  }, [liveCreatives, committedQuery, searchQuery]);

  // When the semantic lane returned product hits, use ONLY those results.
  // Do NOT append filteredCreatives: it uses a substring catalog_tags match
  // (e.g. a product tagged "tennis shoes" matches a "shoes" search), which
  // is broader than nl-search's canonical product.type filter and causes
  // unrelated items to appear a few seconds after the correct results land.
  // Falls through to filteredCreatives only when nl-search returned nothing.
  const semanticallyOrderedCreatives = useMemo<ProductAd[]>(() => {
    if (semanticCreatives.length === 0) return filteredCreatives;
    const seen = new Set<string>();
    const out: ProductAd[] = [];
    for (const c of semanticCreatives) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    return out;
  }, [semanticCreatives, filteredCreatives]);

  // ── Final creative list: brand fast-path > tier-1 catalog_tags > semantic ──
  // When the user's query is an exact brand name, return only that brand's
  // creatives - intent is unambiguous, blending with semantic would dilute
  // the result. Otherwise tier-1 (catalog_tags) leads, with semantic + elite
  // following, deduped by id and product_id.
  const renderedCreatives = useMemo<ProductAd[]>(() => {
    const q = committedQuery.trim().toLowerCase();
    const brandMatch = q && brandQueryRef.current === q ? brandMatchedCreatives : [];
    if (brandMatch.length > 0) {
      const seen = new Set<string>();
      const seenProducts = new Set<string>();
      const out: ProductAd[] = [];
      for (const c of brandMatch) {
        if (seen.has(c.id)) continue;
        if (c.product_id && seenProducts.has(c.product_id)) continue;
        seen.add(c.id);
        if (c.product_id) seenProducts.add(c.product_id);
        out.push(c);
      }
      return out;
    }
    const tagMatch = q && tagQueryRef.current === q ? tagMatchedCreatives : [];
    if (tagMatch.length === 0) return semanticallyOrderedCreatives;

    // Tier-1 found typed products - return those exclusively.
    // Appending semanticallyOrderedCreatives would inject off-type semantic
    // drift (e.g. "shoes" dense-neighbours skirts/dresses) after the correct
    // results land. When the user gave us a typed query and tier-1 matched it,
    // we can satisfy their intent with exactly those results.
    const seen = new Set<string>();
    const out: ProductAd[] = [];
    for (const c of tagMatch) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    return out;
  }, [brandMatchedCreatives, tagMatchedCreatives, semanticallyOrderedCreatives, committedQuery]);

  // Log search queries through the batch endpoint. Debounced 1.5 s and
  // prefix-deduped so mid-typing keystrokes don't each enqueue an entry;
  // the queue itself flushes every 5 s or on tab close, so a user's
  // session of pauses lands as one POST.
  const { user } = useAuth();
  const lastLoggedQueryRef = useRef<string>('');
  useEffect(() => {
    const q = committedQuery.trim().toLowerCase();
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
  }, [committedQuery, semanticallyOrderedLooks.length, activeFilter, user]);

  // Reset when filters/search/shuffle change - use committedQuery so the
  // feed only resets after nl-search resolves, not on every keystroke.
  const prevFilterRef = useRef({ activeFilter, committedQuery, shuffleKey });
  useEffect(() => {
    const prev = prevFilterRef.current;
    if (
      prev.activeFilter !== activeFilter ||
      prev.committedQuery !== committedQuery ||
      prev.shuffleKey !== shuffleKey
    ) {
      prevFilterRef.current = { activeFilter, committedQuery, shuffleKey };
      // Only remount the segment tree when there are actual new look results,
      // or when clearing the search back to the full feed. Skipping RESET on a
      // no-results query keeps segment keys stable so video IntersectionObserver
      // callbacks don't need to re-fire (avoids black-card flicker).
      if (semanticallyOrderedLooks.length > 0 || committedQuery.trim().length === 0) {
        dispatch({ type: 'RESET', looks: semanticallyOrderedLooks });
      }
    }
  }, [activeFilter, committedQuery, shuffleKey, semanticallyOrderedLooks]);

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

  // Delete-on-feed is destructive on a public surface - only super-admins
  // see the trash affordance, and only when they've explicitly toggled
  // "Delete mode" on from the account menu. Off by default so a stray
  // tap on a public surface can't nuke a product.
  const [deleteMode] = useDeleteMode();
  const canDeleteCreative = user?.role === 'super_admin' && deleteMode;

  const handleDeleteCreative = useCallback(async (id: string) => {
    // Super-admin long-press on the consumer feed deletes the underlying
    // PRODUCT, not just the one creative - by the time someone gets to
    // the consumer surface to nuke a tile, they want it gone everywhere
    // (every creative that referenced this product disappears too).
    setLiveCreatives(prev => {
      const target = prev.find(c => c.id === id);
      const productId = target?.product?.id;
      if (!productId) {
        // Creative has no product link - fall back to single-creative
        // delete so the tile still goes away.
        return prev.filter(c => c.id !== id);
      }
      return prev.filter(c => c.product?.id !== productId);
    });
    const target = liveCreatives.find(c => c.id === id);
    const productId = target?.product?.id;
    if (!productId) {
      // Single-creative path (no product attached).
      const { error } = await deleteProductAd(id);
      if (error) {
        console.error('[ContinuousFeed] deleteProductAd failed:', error);
        alert(`Could not delete creative: ${error}`);
        getHomeFeed().then(setLiveCreatives).catch(() => {});
      }
      return;
    }
    const { error } = await deleteProduct(productId);
    if (error) {
      console.error('[ContinuousFeed] deleteProduct failed:', error);
      alert(`Could not delete product: ${error}`);
      getHomeFeed().then(setLiveCreatives).catch(() => {});
    }
  }, [liveCreatives]);

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

  // ── Stale-while-refresh ──────────────────────────────────────────────────
  // Keep previous feed content visible at all times during a search refresh.
  // The loader bar appears above, content swaps with a fade when results land.
  // Empty results never blank the feed - they show a transient toast instead.
  const trimmedQuery = committedQuery.trim();
  const liveTrimmed = searchQuery.trim();
  const semanticActive = trimmedQuery.length >= 3;
  const semanticPending = !tier1Eligible && liveTrimmed.length >= 3 && (semantic.loading || liveTrimmed !== trimmedQuery);

  // Searching = there is an in-flight or pending fetch for a NEW query.
  // We fire this even when the previous search's results are still on screen
  // so the loader bar is visible and the stale-content path takes over the
  // grid render (otherwise the old results sit there until the new ones land
  // and visibly "snap" without a loading affordance).
  const isSearching = semanticActive || semanticPending
    ? (semantic.loading || semanticPending || liveTrimmed !== trimmedQuery)
    : false;

  const [staleCreatives, setStaleCreatives] = useState<ProductAd[]>([]);
  const [staleLooks, setStaleLooks] = useState<Look[]>([]);
  const [feedContentKey, setFeedContentKey] = useState(0);
  const prevSearchingRef = useRef(false);

  // Cache last successful content for stale display.
  useEffect(() => {
    if (!isSearching && renderedCreatives.length > 0) setStaleCreatives(renderedCreatives);
  }, [renderedCreatives, isSearching]);

  useEffect(() => {
    if (!isSearching && semanticallyOrderedLooks.length > 0) setStaleLooks(semanticallyOrderedLooks);
  }, [semanticallyOrderedLooks, isSearching]);

  // Toast state - fires when a search resolves with no results.
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect search resolving: loading → done transition.
  useEffect(() => {
    const justFinished = prevSearchingRef.current && !isSearching;
    prevSearchingRef.current = isSearching;
    if (!justFinished) return;

    const hasResults = renderedCreatives.length > 0 || semanticallyOrderedLooks.length > 0;
    if (hasResults) {
      setFeedContentKey(k => k + 1);
    } else if (liveTrimmed.length > 0) {
      const label = liveTrimmed.length > 30 ? liveTrimmed.slice(0, 30) + '…' : liveTrimmed;
      setToastMsg(`No results for "${label}"`);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToastMsg(null), 3000);
    }
  }, [isSearching, renderedCreatives.length, semanticallyOrderedLooks.length, liveTrimmed]);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  // When a search has resolved (not in-flight), never fall back to stale
  // content - show only the exact search results (may be empty → empty grid
  // + toast). Stale content is only shown during the in-flight window so the
  // grid doesn't flash white while nl-search loads.
  const searchResolved = semanticActive && !isSearching;
  const displayCreatives = isSearching
    ? (staleCreatives.length > 0 ? staleCreatives : renderedCreatives)
    : searchResolved
      ? renderedCreatives
      : (renderedCreatives.length > 0 ? renderedCreatives : staleCreatives);
  const displayLooks = isSearching
    ? (staleLooks.length > 0 ? staleLooks : semanticallyOrderedLooks)
    : searchResolved
      ? semanticallyOrderedLooks
      : (semanticallyOrderedLooks.length > 0 ? semanticallyOrderedLooks : staleLooks);

  // When a search has fully resolved with zero results, show the persistent
  // EmptyCatalogState (with the "I want this catalog" demand-signal CTA)
  // instead of leaving the grid blank and relying on the 3-second toast.
  const showEmptyState =
    searchResolved &&
    !isSearching &&
    displayCreatives.length === 0 &&
    displayLooks.length === 0 &&
    trimmedQuery.length > 0;
  // Title-case the query so "hair care" reads as "Hair Care" in the headline.
  const emptyCatalogName = trimmedQuery.replace(/\b\w/g, c => c.toUpperCase());

  return (
    <div className="continuous-feed" id="grid-viewport">
      {/* Top overlay loader - appears above existing content during search. */}
      {isSearching && (
        <div className="feed-search-loader" aria-hidden="true">
          <div className="feed-search-loader-bar" />
        </div>
      )}
      {/* No-results toast - suppressed when the persistent empty state is shown. */}
      {toastMsg && !showEmptyState && (
        <div className="feed-no-results-toast" role="status">{toastMsg}</div>
      )}
      {showEmptyState && (
        <EmptyCatalogState catalogName={emptyCatalogName} />
      )}
      <div key={feedContentKey} className={feedContentKey > 0 ? 'feed-content-fadein' : undefined} hidden={showEmptyState}>
        {state.segments.map((segment, idx) => {
          if (segment.type === 'feed') {
            return (
              <FeedSection
                key={segment.id}
                looks={segment.isInitial ? displayLooks : segment.looks}
                onOpenLook={handleOpenLook}
                onOpenCreator={onOpenCreator}
                onCreateCatalog={onCreateCatalog}
                onOpenCreativeProduct={handleOpenCreativeProduct}
                creatives={segment.isInitial ? displayCreatives : undefined}
                creativesLoading={segment.isInitial ? creativesLoading : false}
                canDeleteCreative={canDeleteCreative}
                onDeleteCreative={handleDeleteCreative}
                title={segment.title}
                isInitial={segment.isInitial}
                layoutMode={layoutMode}
                searchMode={segment.isInitial && (semantic.creatives.length > 0 || tagMatchedCreatives.length > 0 || brandMatchedCreatives.length > 0)}
                onLoadMore={segment.isInitial ? semantic.loadMore : undefined}
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
                onOpenBrand={onOpenBrand}
                onCreateCatalog={onCreateCatalog}
                bookmarks={bookmarks}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
