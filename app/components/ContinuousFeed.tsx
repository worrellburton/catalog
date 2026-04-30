import { useReducer, useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { looks as staticLooksFallback, type Look, type Product } from '~/data/looks';
import { getLooks } from '~/services/looks';
import { getSimilarLooks } from '~/utils/similarity';
import FeedSection from './FeedSection';
import InlineLookDetail from './InlineLookDetail';
import EmptyCatalogState from './EmptyCatalogState';
import { prefetchLiveAds, getLiveAds, getCreativesByCatalogTag, creativeMatchesCatalogQuery, resolveCatalogTypes, deleteProductAd, deleteProduct, type ProductAd } from '~/services/product-creative';
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
  onCreateCatalog,
  bookmarks,
  onSearchLoadingChange,
  searchTrigger = 0,
}: ContinuousFeedProps) {
  // ── Committed query — the feed only updates when nl-search resolves ─────
  // While the user is typing (or nl-search is in flight), committedQuery stays
  // at the last resolved value so the grid doesn't jump on every keystroke.
  // For short queries (< 3 chars, no semantic call) we commit immediately.
  // Tier-1 (catalog_tags) hits also commit immediately — see tagMatchedCreatives.
  const [committedQuery, setCommittedQuery] = useState('');
  const wasLoadingRef = useRef(false);

  // Short / empty queries: commit immediately (no semantic search fires).
  // Tier-1 eligible queries (catalog types like "shoes") also commit
  // immediately — we know nl-search is disabled for them and the tag
  // fast-path will populate results within ~10 ms.
  useEffect(() => {
    if (searchQuery.trim().length < 3 || !!resolveCatalogTypes(searchQuery)) {
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
    // Gender filter: 'men' includes 'unisex' looks too (and vice-versa)
    // so catalog-wide staples surface for everyone regardless of the
    // shopper's profile gender.
    const base = activeFilter === 'all'
      ? allLooks
      : allLooks.filter(l => l.gender === activeFilter || l.gender === 'unisex');
    if (committedQuery) {
      const q = committedQuery.toLowerCase();
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
  // We still run semantic in the background to broaden coverage, but we
  // suppress the pending/loading UX so the UI stays instant.
  const tier1Eligible = !!resolveCatalogTypes(searchQuery);
  // Skip nl-search entirely for tier-1 catalog queries — the in-memory +
  // DB tag fast-path already returns the full type-constrained result set
  // in <50ms, so paying for an OpenAI embed + edge-function round-trip
  // (often 5-10s on cold starts) just to re-rank the same rows is waste.
  const semantic = useSemanticSearch(searchQuery, { gender: genderOpt, trigger: searchTrigger, enabled: !tier1Eligible });

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
      // Top up from DB asynchronously — the in-memory pool is the elite
      // subset, so the full catalog usually has more rows behind it.
      let cancelled = false;
      getCreativesByCatalogTag(q).then(rows => {
        if (cancelled || tagQueryRef.current !== q) return;
        if (rows.length > inMemory.length) {
          setTagMatchedCreatives(rows);
          tagCacheRef.current.set(q, rows);
          // LRU eviction — Map preserves insertion order, so the oldest
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

    // 2. DB lookup — only when we haven't already committed via in-memory.
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
        // Cold miss for the tag path — clear so we don't show stale results
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
  // the joined product fields — no client-side hydration through
  // products/look_products needed.
  const semanticCreatives = useMemo<ProductAd[]>(() => {
    if (!semantic.creatives.length) return [];
    return semantic.creatives.map(c => ({
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
  }, [semantic.creatives]);

  useEffect(() => {
    if (semanticCreatives.length) primeTrailAssets(semanticCreatives);
  }, [semanticCreatives]);

  // Filter creatives by the current search. If any product in the library has
  // catalog_tags that match the query (case-insensitive), treat the search as
  // a catalog lookup and keep only creatives whose product is tagged with it.
  // Otherwise fall back to a text match on product name / brand.
  const filteredCreatives = useMemo(() => {
    const q = committedQuery.trim().toLowerCase();
    // Live (uncommitted) query — used to suppress the elite fallback the
    // moment the user starts typing a semantic-eligible query, so the grid
    // doesn't flash with unrelated creatives while nl-search is in flight.
    const liveQ = searchQuery.trim().toLowerCase();
    if (liveQ.length >= 3 && liveQ !== q) {
      // Semantic search is pending — show nothing from the text/elite lane.
      // semanticallyOrderedCreatives + the sourcing state below take over.
      return [];
    }
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
    // When the query is long enough to trigger the semantic lane (≥ 3 chars),
    // do NOT fall back to the full live pool on a text miss — that floods the
    // grid with unrelated products (e.g. wool sweaters for "summer"). Return []
    // so only the semantically-ranked video creatives fill the grid.
    // Short queries (<3 chars, text-only) still fall back to everything so the
    // grid isn't blank while the user is mid-word.
    if (matches.length === 0) return q.length >= 3 ? [] : liveCreatives;
    return matches;
  }, [liveCreatives, committedQuery, searchQuery]);

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

  // ── Final creative list: tier-1 (catalog_tags) results render first ──────
  // When the user's query matches a known catalog, those creatives appear at
  // the top synchronously. Semantic + elite results follow, deduped by id and
  // by product_id so the same product never stacks.
  const renderedCreatives = useMemo<ProductAd[]>(() => {
    const q = committedQuery.trim().toLowerCase();
    const tagMatch = q && tagQueryRef.current === q ? tagMatchedCreatives : [];
    if (tagMatch.length === 0) return semanticallyOrderedCreatives;

    const seen = new Set<string>();
    const seenProducts = new Set<string>();
    const out: ProductAd[] = [];
    for (const c of tagMatch) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      if (c.product_id) seenProducts.add(c.product_id);
      out.push(c);
    }
    for (const c of semanticallyOrderedCreatives) {
      if (seen.has(c.id)) continue;
      if (c.product_id && seenProducts.has(c.product_id)) continue;
      seen.add(c.id);
      if (c.product_id) seenProducts.add(c.product_id);
      out.push(c);
    }
    return out;
  }, [tagMatchedCreatives, semanticallyOrderedCreatives, committedQuery]);

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

  // Reset when filters/search/shuffle change — use committedQuery so the
  // feed only resets after nl-search resolves, not on every keystroke.
  const prevFilterRef = useRef({ activeFilter, committedQuery, shuffleKey });
  useEffect(() => {
    const prev = prevFilterRef.current;
    if (
      prev.activeFilter !== activeFilter ||
      prev.committedQuery !== committedQuery ||
      prev.shuffleKey !== shuffleKey
    ) {
      dispatch({ type: 'RESET', looks: semanticallyOrderedLooks });
      prevFilterRef.current = { activeFilter, committedQuery, shuffleKey };
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

  // Delete-on-feed is destructive on a public surface — gate to admins
  // (admin or super_admin). Regular shoppers / creators don't see the
  // trash affordance.
  const canDeleteCreative = user?.role === 'super_admin' || user?.role === 'admin';

  const handleDeleteCreative = useCallback(async (id: string) => {
    // Super-admin long-press on the consumer feed deletes the underlying
    // PRODUCT, not just the one creative — by the time someone gets to
    // the consumer surface to nuke a tile, they want it gone everywhere
    // (every creative that referenced this product disappears too).
    setLiveCreatives(prev => {
      const target = prev.find(c => c.id === id);
      const productId = target?.product?.id;
      if (!productId) {
        // Creative has no product link — fall back to single-creative
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
        getLiveAds().then(setLiveCreatives).catch(() => {});
      }
      return;
    }
    const { error } = await deleteProduct(productId);
    if (error) {
      console.error('[ContinuousFeed] deleteProduct failed:', error);
      alert(`Could not delete product: ${error}`);
      getLiveAds().then(setLiveCreatives).catch(() => {});
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

  // Empty-catalog state: shopper searched something we have nothing for.
  // We only show this once the initial fetch has resolved (don't flash an
  // empty state during the brief mount-to-data window) and only when the
  // search bar has actual user intent in it (so unfiltered "all" never lands
  // here, even on a brand-new install with zero data).
  //
  // When the semantic search is still in-flight (loading=true) or returned a
  // cold-miss, we show the empty state with a "sourcing" flag so the copy
  // reads "We're finding this for you" rather than "nothing here yet".
  // Empty-catalog and sourcing states use committedQuery so they only
  // appear after the search has resolved, not while the user is still typing.
  const trimmedQuery = committedQuery.trim();
  const liveTrimmed = searchQuery.trim();
  const semanticActive = trimmedQuery.length >= 3;
  // Pending = user has typed enough to fire semantic but it hasn't resolved yet.
  const semanticPending = !tier1Eligible && liveTrimmed.length >= 3 && (semantic.loading || liveTrimmed !== trimmedQuery);
  const showEmptyState =
    !creativesLoading &&
    !semantic.loading &&
    !semanticPending &&
    trimmedQuery.length > 0 &&
    renderedCreatives.length === 0 &&
    semanticallyOrderedLooks.length === 0;

  // While semantic search is loading (only for long-enough queries), show the
  // sourcing state immediately so the user sees feedback during the round-trip.
  // Tier-1 (catalog_tags) hits suppress the sourcing screen — if we already
  // have results to render, don't flash a loading state.
  const showSourcingState =
    !showEmptyState &&
    (semanticActive || semanticPending) &&
    (semantic.loading || semanticPending) &&
    renderedCreatives.length === 0 &&
    filteredLooks.length === 0;

  if (showEmptyState || showSourcingState) {
    return (
      <EmptyCatalogState
        // While sourcing, prefer the live query so a fresh "Shirts"
        // search doesn't render under the previous "Pants" heading.
        // Empty (committed) state still uses the committed query —
        // that's the result the user actually got back.
        catalogName={showSourcingState ? (liveTrimmed || trimmedQuery) : trimmedQuery}
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
              creatives={segment.isInitial ? renderedCreatives : undefined}
              creativesLoading={segment.isInitial ? creativesLoading : false}
              canDeleteCreative={canDeleteCreative}
              onDeleteCreative={handleDeleteCreative}
              title={segment.title}
              isInitial={segment.isInitial}
              layoutMode={layoutMode}
              searchMode={segment.isInitial && (semantic.creatives.length > 0 || tagMatchedCreatives.length > 0)}
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
              onCreateCatalog={onCreateCatalog}
              bookmarks={bookmarks}
            />
          </div>
        );
      })}
    </div>
  );
}
