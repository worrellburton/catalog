import { useReducer, useEffect, useRef, useCallback, useMemo, useState, memo } from 'react';
import { catalogAlert } from '~/components/CatalogDialog';
import { looks as staticLooksFallback, type Look, type Product } from '~/data/looks';
import { getLooks, getCachedLooks, subscribeToLooksChange, fetchSeenLookIds, reorderBySeen } from '~/services/looks';
import { trackImpression } from '~/services/session-tracker';
import { getSimilarLooks } from '~/utils/similarity';
import FeedSection from './FeedSection';
import { FeedWhyProvider } from './feed/FeedWhyContext';
import type { FeedWhyContextData } from '~/services/feed-why';
import InlineLookDetail from './InlineLookDetail';
import EmptyCatalogState from './EmptyCatalogState';
import { prefetchHomeFeed, getCachedHomeFeed, getHomeFeed, getCreativesByCatalogTag, getCreativesByBrandQuery, resolveBrandFromQuerySync, creativeMatchesCatalogQuery, resolveCatalogTypes, resolveMaterialKeywords, deleteProductAd, deleteProduct, subscribeToShopperGender, getShopperGender, type ProductAd } from '~/services/product-creative';
import { primeTrailAssets, primeLookAssets } from '~/utils/trailPrefetch';
import { supabase } from '~/utils/supabase';
import { logSearch } from '~/services/search-log';
import { useAuth } from '~/hooks/useAuth';
import { useShopperBody } from '~/hooks/useShopperBody';
import { lookFitScore } from '~/services/size-match';
import { useHiddenLooks, useHiddenLookUuids, useHiddenProductKeys, hideLookId, isLookHidden } from '~/hooks/useHiddenLooks';
import { deleteLook as deleteLookService } from '~/services/manage-looks';
import { useDeleteMode } from '~/hooks/useDeleteMode';
import { getSeenKeys, partitionUnseen, type SeenKey } from '~/services/seen-feed';
import { useSearch } from '~/hooks/useSearch';
import { director } from '~/services/video-playback-director';
import { useUserAffinity } from '~/hooks/useUserAffinity';
import { getFeedRules } from '~/services/dials';
import { composeRenderedCreatives } from '~/services/feed-compose';
import { recordRecentSearch } from '~/services/recent-searches';
import { getPersonalizedProductOrder, getPersonalizedLookOrder } from '~/services/personalized-feed';

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
  /** Called when a search resolves, with the first few result product images
   *  (so the search ceremony can float them in the particle field behind it). */
  onResultsReady?: (images: string[]) => void;
  /** Incremented on each Enter/submit to bypass debounce and fire immediately. */
  searchTrigger?: number;
  /** When set, the feed only surfaces looks whose creator handle is
   *  in this list (lower-cased). Used by the FollowingRail's
   *  "Make a catalog of who I follow" CTA. null disables the
   *  filter. */
  followedHandles?: string[] | null;
  /** When true, only show looks where at least one product is available
   *  in the shopper's predicted size. Toggled by the "My Size" chip in
   *  BottomBar. */
  mySizeOnly?: boolean;
  /**
   * When true the feed is rendered nested inside another scroll surface
   * (e.g. ProductPage or LookOverlay's "You might also like" slot). Omits
   * the `id="grid-viewport"` hook so global `#grid-viewport` CSS rules
   * (feed-mode/landing-mode/etc.) don't double-target the nested instance.
   */
  nested?: boolean;
  /**
   * Optional scroll container for nested usage. When the feed lives inside
   * an overflow:auto overlay, pass that element so the load-more sentinel
   * triggers based on the overlay's edges instead of the window viewport.
   */
  scrollRoot?: HTMLElement | null;
  /**
   * Forwarded to every FeedSection rendered by this feed. Namespaces
   * CreativeCardV2 slotIds so overlay feeds never collide with the main
   * feed's director registrations. See FeedSection.slotPrefix.
   */
  slotPrefix?: string;
  /**
   * Mobile column count (1 / 2 / 3) from the home-feed grid-density dial.
   * Forwarded to every FeedSection so the grid renders an inline
   * gridTemplateColumns (bulletproof — see FeedSection.feedCols). Only the
   * main home feed passes this; nested/overlay instances leave it undefined
   * (FeedSection defaults to 2 columns on mobile).
   */
  feedCols?: number;
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

      const raw = getSimilarLooks(look, allLooks, 8, newSeen);
      raw.forEach(l => newSeen.add(l.id));

      // Pad to exactly 8 by cycling duplicates with unique negative IDs
      // (same approach as fillLooks in LookOverlay).
      const related: Look[] = [...raw];
      while (related.length < 8 && raw.length > 0) {
        const src = raw[related.length % raw.length];
        related.push({ ...src, id: -(src.id * 1000 + related.length) });
      }

      return {
        segments: [
          ...state.segments,
          { type: 'detail', id: `detail-${look.id}-${Date.now()}`, look },
          { type: 'feed', id: `feed-${look.id}-${Date.now()}`, looks: related, title: 'Similar' },
        ],
        seenLookIds: newSeen,
      };
    }
    case 'RESET':
      return {
        segments: [
          // Stable id — changing this would remount FeedSection and tear
          // down every CreativeCardV2's director-managed <video>. Looks
          // update via props instead.
          { type: 'feed', id: 'initial', looks: action.looks, isInitial: true },
        ],
        seenLookIds: new Set<number>(),
      };
    default:
      return state;
  }
}

function ContinuousFeed({
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
  onResultsReady,
  searchTrigger = 0,
  followedHandles,
  mySizeOnly = false,
  nested = false,
  scrollRoot = null,
  slotPrefix,
  feedCols,
}: ContinuousFeedProps) {
  // Declared early so fitRankedLooks (below) can reference shopperBody.
  // The same `user` is reused by the search-log telemetry block further down.
  const { user } = useAuth();
  const shopperBody = useShopperBody(user?.id);
  // Per-shopper category lean (clicks + searches). Drives the soft affinity
  // re-rank applied to the default home / "you might also like" feed below.
  const affinity = useUserAffinity();

  // ── Automatic Editor — daily personalized product order ──────────────
  // An ordered list of product ids the personalize-feed edge function ranked
  // for this shopper today. null = personalization off / holdout / guest /
  // error (the default global feed_rank order is left untouched). Fetched
  // once on mount and re-fetched when the signed-in user changes, behind the
  // service's own dial gate + per-day localStorage cache. Only ever applied
  // to the default home feed's product lane below.
  const [personalizedOrder, setPersonalizedOrder] = useState<string[] | null>(null);
  // The Daily Feed also ranks LOOKS per shopper (look uuids, best-first). We
  // float these to the front of the look lane, mirroring the product lane.
  const [personalizedLookOrder, setPersonalizedLookOrder] = useState<string[] | null>(null);

  // "Boost brands they saved" feed rule (admin rulebook in app_settings).
  // Bookmarks are on-device, so this is the one rule applied client-side:
  // read the rule once per mount, snapshot the saved brands, and hand the
  // pair to the composer. Null when the rule is off or nothing is saved.
  const [savedBrandBoost, setSavedBrandBoost] = useState<{ brands: Set<string>; weight: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getFeedRules().then(rules => {
      if (cancelled || !rules.savedBrands.enabled) return;
      try {
        const raw = localStorage.getItem('catalog_bookmarked_products');
        const saved = raw ? (JSON.parse(raw) as { brand?: string | null }[]) : [];
        const brands = new Set(saved.map(p => (p.brand || '').toLowerCase()).filter(Boolean));
        if (brands.size > 0) {
          setSavedBrandBoost({ brands, weight: Math.min(8, Math.max(1, Math.round(rules.savedBrands.weight))) });
        }
      } catch { /* unreadable bookmarks — rule silently off */ }
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    getPersonalizedProductOrder().then(ids => {
      if (!cancelled) setPersonalizedOrder(ids);
    });
    getPersonalizedLookOrder().then(ids => {
      if (!cancelled) setPersonalizedLookOrder(ids);
    });
    return () => { cancelled = true; };
  }, [user?.id]);

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

  // ── Catalog impression telemetry ──────────────────────────────────────
  // When committedQuery commits to a catalog name (resolved by the
  // catalog-types fast path or surfaced as tier-1 catalog_tag hits)
  // the user is effectively "viewing" that catalog. Fire one
  // impression per distinct catalog name per session — admins read
  // this in /admin/catalogs to rank by audience demand. Empty/short
  // queries are skipped; the home feed already logs its own
  // impressions via look + product trackers.
  const catalogImpressionFiredRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const q = committedQuery.trim().toLowerCase();
    if (q.length < 2) return;
    if (catalogImpressionFiredRef.current.has(q)) return;
    catalogImpressionFiredRef.current.add(q);
    trackImpression({ type: 'catalog', id: q, context: q.slice(0, 120) });
  }, [committedQuery]);

  // ── Director scroll notifications ─────────────────────────────────────
  // Keeps the playback director in sync with the page scroll position so
  // it can re-rank and recover stalled cards after a fast flick.
  useEffect(() => {
    const onScroll = () => director.notifyScroll(window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // ── Filtering uses committedQuery so grid doesn't change while typing ──
  // must never appear in the consumer feed, detail pages, or similar-look rows.
  const hiddenLookIds = useHiddenLooks();
  const hiddenLookUuids = useHiddenLookUuids();
  const hiddenProductKeys = useHiddenProductKeys();

  // Load looks live from Supabase. Stale-while-revalidate: seed from
  // localStorage on mount (instant on return visits) and revalidate in
  // the background so the cache stays fresh.
  const initialCachedLooks = useMemo(() => getCachedLooks(), []);
  const [dbLooks, setDbLooks] = useState<Look[]>(initialCachedLooks || []);
  useEffect(() => {
    if (initialCachedLooks?.length) primeLookAssets(initialCachedLooks);
  }, [initialCachedLooks]);
  // Realtime sync: services/looks.ts owns a Supabase channel that
  // listens to looks + looks_creative changes and broadcasts via
  // subscribeToLooksChange. Whenever an admin deletes / unpublishes /
  // newly-publishes a look, this listener refetches and the consumer
  // feed updates live without a refresh. The cache is invalidated
  // inside the service before the broadcast fires, so getLooks()
  // here actually round-trips to the DB.
  useEffect(() => {
    return subscribeToLooksChange(() => {
      getLooks().then(setDbLooks).catch(() => {});
    });
  }, []);
  // (Looks are now fetched inside the combined effect below — this
  // useEffect preserves the hook-count contract for HMR stability.)
  useEffect(() => { /* combined fetch below handles looks revalidation */ }, []);

  // Seen-look set for the signed-in shopper. Used by the unseen-first
  // ordering rule applied to allLooks below. Re-fetched on mount and
  // whenever the cached looks set changes (so a freshly-published look
  // is treated as unseen until the impression fires).
  const [seenLookIds, setSeenLookIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!user?.id) { setSeenLookIds(new Set()); return; }
    fetchSeenLookIds(user.id).then(setSeenLookIds).catch(() => setSeenLookIds(new Set()));
  }, [user?.id, dbLooks.length]);

  const allLooks = useMemo(() => {
    const filtered = dbLooks
      .filter(l => !isLookHidden(l, hiddenLookIds, hiddenLookUuids))
      .map(l => ({
        ...l,
        products: l.products.filter(p => !hiddenProductKeys.has(`${p.brand}-${p.name}`)),
      }));
    // Anonymous shoppers see the natural feed order untouched —
    // reorderBySeen no-ops with an empty seen set.
    return reorderBySeen(filtered, seenLookIds);
    // shuffleKey is a deliberate dep (not read inside): it bumps on every
    // feed (re)entry / shuffle, so the seen-shuffle re-runs and a returning
    // shopper who's seen everything gets a fresh order instead of the same
    // frozen one for the whole SPA session.
  }, [dbLooks, hiddenLookIds, hiddenLookUuids, hiddenProductKeys, seenLookIds, shuffleKey]);

  // Shopper's profile gender, subscribed globally. Declared ABOVE
  // filteredLooks so the useMemo below can read it without tripping
  // the temporal dead zone — production minification can hoist the
  // useMemo factory call ahead of the useState declaration if these
  // are reordered.
  const [profileGender, setProfileGender] = useState(() => getShopperGender());
  useEffect(() => {
    const off = subscribeToShopperGender(() => setProfileGender(getShopperGender()));
    return off;
  }, []);

  // Per-user "seen" set — drives hiding already-seen thumbnails on the
  // default home feed (re-login skips what you've seen; once you've seen
  // everything it resets). Loaded once per mount; empty for guests, so
  // they always see the full feed. Search / catalog-filtered views are
  // never seen-filtered (the shopper asked for those exact results).
  const [seenKeys, setSeenKeys] = useState<Set<SeenKey>>(() => new Set());
  useEffect(() => {
    let cancelled = false;
    getSeenKeys().then(set => { if (!cancelled) setSeenKeys(set); });
    return () => { cancelled = true; };
    // Re-pull when the signed-in user changes (login/logout).
  }, [user?.id]);

  const filteredLooks = useMemo(() => {
    // Gender filter: 'men' includes 'unisex' looks too (and vice-versa)
    // so catalog-wide staples surface for everyone regardless of the
    // shopper's profile gender.
    //
    // When the explicit catalog filter is 'all', fall back to the
    // signed-in shopper's profile gender — this is the same rule the
    // product feed already applies via passesGenderFilter, so a male
    // shopper doesn't see women's looks just because the catalog
    // chip is set to "all". 'unknown' still shows everything.
    const profileGenderFilter: 'men' | 'women' | null =
      profileGender === 'male' ? 'men' : profileGender === 'female' ? 'women' : null;
    const effectiveFilter: 'all' | 'men' | 'women' =
      activeFilter !== 'all' ? activeFilter : (profileGenderFilter ?? 'all');
    let base = effectiveFilter === 'all'
      ? allLooks
      : allLooks.filter(l => l.gender === effectiveFilter || l.gender === 'unisex');
    // "Make a catalog of who I follow" — narrow to looks whose
    // creator handle matches one in the followedHandles set.
    // Empty list means "nobody followed" → empty feed instead of
    // bypassing the filter.
    if (followedHandles) {
      const allow = new Set(followedHandles);
      base = base.filter(l => {
        const handle = (l.creator || '').toLowerCase().trim();
        return allow.has(handle);
      });
    }
    if (committedQuery) {
      const q = committedQuery.toLowerCase();
      // For queries >= 3 chars, the semantic search pipeline handles look
      // ranking (search_looks RPC). Return base unfiltered — the
      // searchMatchedLooks useMemo (declared after the semantic hook)
      // will narrow to relevant looks by UUID match.
      if (q.length >= 3) return base;
      return base.filter(l =>
        l.title.toLowerCase().includes(q) ||
        l.creator.toLowerCase().includes(q) ||
        l.description.toLowerCase().includes(q) ||
        l.products.some(p => p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q))
      );
    }
    return base;
  }, [activeFilter, committedQuery, allLooks, followedHandles, profileGender]);

  // ── Semantic search ────────────────────────────────────────────────────────
  // Kicks in for queries ≥ 3 chars; reorders filteredLooks so semantically
  // ranked looks float to the top. Falls back to the local text filter when
  // the edge function is unavailable or the query is too short.
  // When the explicit men/women chip is active, that wins. Otherwise
  // fall back to the shopper's profile gender so a signed-in male
  // shopper's search results never leak women's items (and vice-versa).
  // Signed-out / 'unknown' still skips the filter so the public feed
  // shows everything. Subscribed to the global setter so a profile
  // change re-runs the search with the new gender.
  // profileGender + its subscriber effect are declared higher up
  // (above filteredLooks) so that useMemo can read profileGender
  // without tripping the TDZ in production builds.
  // Search filter gender MUST use the products vocab ('male'/'female') — the
  // `search` edge function whitelists only male|female|unisex and silently
  // drops anything else to null (= no filter). Sending the UI 'men'/'women'
  // here was the bug that made search ignore gender entirely. The edge
  // function maps male→men / female→women internally for the looks lane.
  const genderOpt: 'male' | 'female' | undefined =
    activeFilter === 'men'       ? 'male'
    : activeFilter === 'women'   ? 'female'
    : profileGender === 'male'   ? 'male'
    : profileGender === 'female' ? 'female'
    : undefined;
  // Tier-1 eligibility: if the query maps to a known catalog type (e.g.
  // "shoes", "pants"), the in-memory + DB tag fast-path renders first.
  // We still run semantic in the background so Haiku-driven expansion can
  // broaden / refine results, but we suppress the pending/loading UX so
  // the UI stays instant for these common queries.
  const tier1Eligible = !!resolveCatalogTypes(searchQuery);
  // Always run V3 search (gte-small + BM25 + RRF over products). It runs
  // entirely in-edge with no external APIs, so warm queries land in ~60ms
  // and tier-1 still wins the first paint via the catalog_tags fast-path.
  const semantic = useSearch(searchQuery, { gender: genderOpt, trigger: searchTrigger, enabled: true });

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

  // Map semantic look hits (UUIDs) to full Look objects from allLooks.
  // This avoids a second hydration fetch — we reuse the already-loaded
  // look data with full product info, creator avatars, etc.
  const searchMatchedLooks = useMemo<Look[]>(() => {
    if (!semantic.looks.length) return [];
    const looksByUuid = new Map<string, Look>();
    for (const l of filteredLooks) {
      if (l.uuid) looksByUuid.set(l.uuid, l);
    }
    const matched: Look[] = [];
    for (const hit of semantic.looks) {
      const look = looksByUuid.get(hit.id);
      if (look) matched.push(look);
    }
    return matched;
  }, [semantic.looks, filteredLooks]);

  // Surface the first few result product images once a search resolves, so the
  // search ceremony can float them in the particle field behind it.
  useEffect(() => {
    if (!onResultsReady || semantic.loading) return;
    const imgs: string[] = [];
    for (const c of semantic.creatives) {
      const u = c.product_image_url || c.thumbnail_url;
      if (u) imgs.push(u);
      if (imgs.length >= 8) break;
    }
    if (imgs.length < 8) {
      for (const l of searchMatchedLooks) {
        const u = l.thumbnail_url || (l.products && l.products[0]?.image) || '';
        if (u) imgs.push(u);
        if (imgs.length >= 8) break;
      }
    }
    if (imgs.length) onResultsReady(imgs);
  }, [semantic.creatives, semantic.loading, searchMatchedLooks, onResultsReady]);

  // When a semantic search returned look hits, use those (relevance-ranked).
  // Otherwise fall back to the locally-filtered looks (for short queries
  // or when the edge function returned no look results).
  // Soft-rank looks by fit score: looks with products that match the
  // shopper's body float toward the top of the feed without completely
  // reordering. Only applied on the home feed (no search active) and
  // only when the shopper has height data.
  // When mySizeOnly is true, hard-filter to looks where at least one
  // product has the shopper's predicted size available.
  const fitRankedLooks = useMemo(() => {
    if (!shopperBody.heightCm || committedQuery.trim().length >= 3) {
      return mySizeOnly ? [] : filteredLooks;
    }
    let pool = filteredLooks;
    if (mySizeOnly) {
      pool = pool.filter(l => lookFitScore(l.products, shopperBody) > 0);
    }
    const scored = pool.map(l => ({
      look: l,
      fit: lookFitScore(l.products, shopperBody),
    }));
    if (scored.every(s => s.fit === 0)) return pool;
    scored.sort((a, b) => b.fit - a.fit);
    return scored.map(s => s.look);
  }, [filteredLooks, shopperBody, committedQuery, mySizeOnly]);

  const semanticallyOrderedLooks = useMemo(() => {
    const q = committedQuery.trim();
    if (q.length >= 3 && searchMatchedLooks.length > 0) return searchMatchedLooks;
    if (q.length >= 3) return [];
    // Home feed → float the Daily Feed's per-shopper LOOK order to the front
    // (rest keep their fit/feed_rank order), mirroring the product lane, then
    // hide already-seen looks. FeedSection still weaves looks + products by
    // feed_rank with looks leading; this only sets the order among unranked.
    let looks: Look[] = fitRankedLooks;
    if (personalizedLookOrder && personalizedLookOrder.length > 0) {
      const priority = new Map(personalizedLookOrder.map((id, i) => [id, i]));
      const front: Look[] = [];
      const rest: Look[] = [];
      for (const l of looks) {
        if (l.uuid && priority.has(l.uuid)) front.push(l); else rest.push(l);
      }
      front.sort((a, b) => (priority.get(a.uuid!) ?? 0) - (priority.get(b.uuid!) ?? 0));
      looks = [...front, ...rest];
    }
    return partitionUnseen(looks, seenKeys, l => l.uuid ? `look:${l.uuid}` : null);
  }, [fitRankedLooks, searchMatchedLooks, committedQuery, seenKeys, personalizedLookOrder]);

  const [state, dispatch] = useReducer(feedReducer, {
    segments: [{ type: 'feed', id: 'initial', looks: semanticallyOrderedLooks, isInitial: true }],
    seenLookIds: new Set<number>(),
  });

  // Fetch live product creatives + looks from Supabase.
  //
  // Cache-first, no-jank strategy:
  //   - If localStorage has data from a prior visit, the feed renders
  //     from that cache on the very first React commit.
  //   - The network fetch runs in the background but does NOT update
  //     the live feed — it only writes to localStorage so the next
  //     page load picks up fresh data. This prevents the grid from
  //     re-shuffling mid-session.
  //   - When there is NO cache (first visit), the fetch updates live
  //     state so the feed appears as soon as data arrives.
  // Seed state from cache for an instant first paint; the refetch below
  // always overwrites with fresh data (true SWR) so order/content changes
  // reach the screen.
  const initialCached = useMemo(() => getCachedHomeFeed(), []);
  const [liveCreatives, setLiveCreatives] = useState<ProductAd[]>(initialCached || []);
  const [creativesLoading, setCreativesLoading] = useState(!(initialCached && initialCached.length > 0));
  useEffect(() => {
    let cancelled = false;
    if (initialCached) primeTrailAssets(initialCached);

    const refetch = (force = false) => {
      Promise.all([
        getLooks().catch(() => null as Look[] | null),
        prefetchHomeFeed().catch(() => null as ProductAd[] | null),
      ]).then(([freshLooks, freshCreatives]) => {
        if (cancelled) return;
        // True stale-while-revalidate: show the cache instantly (state was
        // seeded from it), THEN always overwrite with the fresh fetch so
        // order/content changes (e.g. the admin's feed_rank arrangement,
        // a gender flip) actually reach the screen. The previous version
        // skipped setState whenever a cache existed, which permanently
        // pinned the stale order — the home feed never reflected the admin
        // FEED order. React reconciles by slotId so the swap is seamless.
        void force;
        if (freshLooks && freshLooks.length > 0) {
          setDbLooks(freshLooks);
          primeLookAssets(freshLooks);
        } else if (!initialCachedLooks) {
          setDbLooks(staticLooksFallback);
        }
        if (freshCreatives) {
          setLiveCreatives(freshCreatives);
          primeTrailAssets(freshCreatives);
        }
        setCreativesLoading(false);
      });
    };

    refetch();
    const unsubscribe = subscribeToShopperGender(() => refetch(true));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [initialCached, initialCachedLooks]);

  // First-paint signal. Tell useAppView the feed has something real
  // to draw, so the auth splash can crossfade over actual cards
  // instead of a blank dark frame. Fires exactly once per mount,
  // one rAF after the first non-empty data commit, so the splash
  // doesn't lift until the next paint actually has tiles in it.
  const feedReadyFiredRef = useRef(false);
  useEffect(() => {
    if (feedReadyFiredRef.current) return;
    if (typeof window === 'undefined') return;
    if (liveCreatives.length === 0 && dbLooks.length === 0) return;
    feedReadyFiredRef.current = true;
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('catalog:feed-ready'));
    });
  }, [liveCreatives.length, dbLooks.length]);

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
    // Apply materialKws filter (e.g. "denim" → only products whose name
    // contains 'denim'/'jean'/'jeans') so the in-memory set is consistent
    // with what getCreativesByCatalogTag returns - otherwise a broad
    // type-match (all Pants/Shorts/Jackets) wins the `rows.length >
    // inMemory.length` guard below and the narrowed DB result is discarded.
    const materialKwsForTag = resolveMaterialKeywords(q);
    const inMemory = liveCreatives.filter(c => {
      if (!creativeMatchesCatalogQuery(c, q)) return false;
      if (materialKwsForTag) {
        const name = ((c.product as { name?: string | null } | null)?.name ?? '').toLowerCase();
        return materialKwsForTag.some(k => name.includes(k));
      }
      return true;
    });
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
    // Only surface rows that have an actual video creative. Placeholder rows
    // (is_placeholder=true / video_url=null) are product-image stand-ins for
    // products that have no creative yet — showing them in search gives the
    // impression that the feed is "pooling photos" instead of creatives.
    // Defense-in-depth gender gate. The edge function already filters by
    // gender, but never let an off-gender tile render even if a stale/cached
    // result slips through. Mirrors passesGenderFilter: a gendered shopper
    // sees their gender + unisex; untagged + opposite are hidden. When no
    // gender is active ('all'/unknown) everything passes.
    const genderAllowed = (g: string | null | undefined): boolean => {
      if (!genderOpt) return true;
      const gl = (g || '').toLowerCase();
      return gl === genderOpt || gl === 'unisex';
    };
    return semantic.creatives
      .filter(c => !c.is_placeholder && c.video_url)
      .filter(c => matchesMaterial(c.product_name))
      .filter(c => genderAllowed(c.product_gender))
      .map(c => ({
      id:               c.id,
      product_id:       c.product_id,
      look_id:          null,
      title:            null,
      description:      null,
      video_url:        c.video_url,
      hls_url:          null,
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
      mobile_video_url: null,
      enabled:          true,
      is_elite:         c.is_elite ?? false,
      created_at:       new Date().toISOString(),
      completed_at:     null,
      updated_at:       null,
      product: {
        id:                c.product_id,
        name:              c.product_name,
        brand:             c.product_brand,
        price:             c.product_price,
        image_url:         c.product_image_url,
        primary_image_url: c.thumbnail_url,
        primary_video_url: c.video_url,
        url:               c.product_url,
        catalog_tags:      null,
        gender:            c.product_gender,
      },
    }));
  }, [semantic.creatives, committedQuery, genderOpt]);

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
    // Ref-gated resolution: a stored match only counts when it belongs to the
    // current committed query. composeRenderedCreatives owns the ordering.
    const brandMatch = q && brandQueryRef.current === q ? brandMatchedCreatives : [];
    const tagMatch = q && tagQueryRef.current === q ? tagMatchedCreatives : [];
    return composeRenderedCreatives({
      committedQuery,
      brandMatch,
      tagMatch,
      semanticOrdered: semanticallyOrderedCreatives,
      seenKeys,
      affinity,
      personalizedOrder,
      savedBrandBoost,
    });
  }, [brandMatchedCreatives, tagMatchedCreatives, semanticallyOrderedCreatives, committedQuery, seenKeys, affinity, personalizedOrder, savedBrandBoost]);

  // Log search queries through the batch endpoint. Debounced 2.5 s and
  // prefix-deduped so a continuous refinement ("i need" → "i need a
  // dress" → "…for a wedding") lands as a SINGLE longest-query row
  // instead of one row per paused partial (each of which used to become
  // its own "catalog"). Two collaborating layers do this:
  //   1. Here: skip backspacing (q is a prefix of the last logged query),
  //      and for forward refinement (q extends last) let the debounce
  //      simply re-arm with the longer q — the cleanup clears the prior
  //      timer, so only the latest/longest query in a chain ever fires.
  //   2. search-log.ts: the queue itself prefix-collapses, so even if an
  //      earlier partial already flushed, the longer one supersedes it.
  // A genuinely DIFFERENT query (no prefix relationship) still logs.
  const lastLoggedQueryRef = useRef<string>('');
  useEffect(() => {
    const q = committedQuery.trim().toLowerCase();
    if (!q || q.length < 2) return;
    const last = lastLoggedQueryRef.current;
    // Backspacing / re-typing a shorter prefix of what we already logged:
    // the longer query already covers it, so don't log a fresh partial.
    if (q === last || last.startsWith(q)) return;
    const timer = setTimeout(() => {
      lastLoggedQueryRef.current = q;
      // Personalization signal: remember this search locally so the affinity
      // model can lean the feed toward the categories the shopper searches for.
      recordRecentSearch(q);
      const handle = user?.displayName || user?.email || localStorage.getItem('catalog_user_handle') || (() => {
        const h = `user_${Math.random().toString(36).slice(2, 8)}`;
        localStorage.setItem('catalog_user_handle', h);
        return h;
      })();
      logSearch({
        query: q,
        user_handle: handle,
        // Count BOTH lanes the shopper actually sees — product tiles
        // (renderedCreatives) AND look tiles. Logging looks-only made every
        // product-returning query ("candles", "quiet luxury") record 0
        // results, so the admin Search analytics showed "0 results / 0% CTR"
        // and looked like search was dead when it was returning 6–12 hits.
        results_count: renderedCreatives.length + semanticallyOrderedLooks.length,
        clicked: false,
        filter: activeFilter,
      });
    }, 2500);
    return () => clearTimeout(timer);
  }, [committedQuery, renderedCreatives.length, semanticallyOrderedLooks.length, activeFilter, user]);

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
        void catalogAlert({ title: 'Could not delete creative', message: String(error) });
        getHomeFeed().then(setLiveCreatives).catch(() => {});
      }
      return;
    }
    const { error } = await deleteProduct(productId);
    if (error) {
      console.error('[ContinuousFeed] deleteProduct failed:', error);
      void catalogAlert({ title: 'Could not delete product', message: String(error) });
      getHomeFeed().then(setLiveCreatives).catch(() => {});
    }
  }, [liveCreatives]);

  // Hard delete a look. Mirrors handleDeleteCreative: optimistic
  // local pull, then the DB-side delete via the manage-looks edge
  // function. Falls back to a soft-hide (admin_hidden_looks +
  // localStorage) when the look has no backend uuid — those are
  // legacy seed entries with no row to delete.
  const handleDeleteLook = useCallback(async (look: Look) => {
    setDbLooks(prev => prev.filter(l => l.id !== look.id));
    if (look.uuid) {
      try {
        await deleteLookService(look.uuid);
      } catch (err) {
        console.error('[ContinuousFeed] deleteLook failed:', err);
        void catalogAlert({ title: 'Could not delete look', message: err instanceof Error ? err.message : 'unknown' });
        getLooks().then(setDbLooks).catch(() => {});
      }
      return;
    }
    // Seed look — soft hide locally so the admin still gets feedback.
    try { await hideLookId(look); } catch { /* localStorage write */ }
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
  // Bumped when a search resolves with results. We do NOT use this as a
  // React `key` (that would unmount the feed subtree, tearing down every
  // CreativeCardV2 and pausing/parking its director-managed <video>).
  // Instead we re-trigger the CSS fade-in animation by toggling the class
  // on the same DOM node — keeps the video pool live and playing.
  const [feedContentKey, setFeedContentKey] = useState(0);
  const feedContentRef = useRef<HTMLDivElement>(null);
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

  // Re-trigger the fade-in animation on the existing DOM node whenever a
  // search resolves. Toggling the class (instead of remounting via `key`)
  // keeps every CreativeCardV2 mounted, so the VideoPlaybackDirector pool
  // is never torn down and videos don't get paused/parked mid-playback.
  useEffect(() => {
    if (feedContentKey === 0) return;
    const el = feedContentRef.current;
    if (!el) return;
    el.classList.remove('feed-content-fadein');
    // Force reflow so the browser restarts the CSS animation.
    void el.offsetWidth;
    el.classList.add('feed-content-fadein');
  }, [feedContentKey]);

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

  // Snapshot of the live composition for the super-admin "why?" buttons.
  // Memoized on the same inputs that drive renderedCreatives so it never
  // churns on unrelated re-renders; read lazily (on tap), never at render.
  const feedWhyData = useMemo<FeedWhyContextData>(() => {
    const q = committedQuery.trim().toLowerCase();
    const semanticRank = new Map<string, number>();
    semanticallyOrderedCreatives.forEach((c, i) => semanticRank.set(c.id, i));
    const personalizedRank = new Map<string, number>();
    (personalizedOrder ?? []).forEach((pid, i) => personalizedRank.set(pid, i));
    const seenProductIds = new Set<string>();
    seenKeys.forEach(k => { if (k.startsWith('product:')) seenProductIds.add(k.slice('product:'.length)); });
    const lookSearchUuids = new Set<string>();
    for (const l of searchMatchedLooks) {
      if (l.uuid) lookSearchUuids.add(l.uuid);
      if (l.id != null) lookSearchUuids.add(String(l.id));
    }
    return {
      committedQuery,
      brandActive: brandMatchedCreatives.length > 0 && brandQueryRef.current === q,
      tagIds: new Set(tagMatchedCreatives.map(c => c.id)),
      semanticRank,
      affinityTopTypes: affinity.topTypes.map(t => t.toLowerCase()),
      personalizedRank,
      savedBrands: savedBrandBoost?.brands ?? new Set<string>(),
      seenProductIds,
      lookSearchUuids,
      lookAffinityTopTypes: affinity.topTypes.map(t => t.toLowerCase()),
    };
  }, [committedQuery, semanticallyOrderedCreatives, personalizedOrder, seenKeys, searchMatchedLooks, brandMatchedCreatives, tagMatchedCreatives, affinity, savedBrandBoost]);

  return (
    <FeedWhyProvider value={feedWhyData}>
    <div className="continuous-feed" id={nested ? undefined : 'grid-viewport'}>
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
      <div ref={feedContentRef} hidden={showEmptyState}>
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
                onDeleteLook={canDeleteCreative ? handleDeleteLook : undefined}
                title={segment.title}
                batchSize={segment.isInitial ? undefined : 8}
                isInitial={segment.isInitial}
                layoutMode={layoutMode}
                searchMode={segment.isInitial && (semantic.creatives.length > 0 || tagMatchedCreatives.length > 0 || brandMatchedCreatives.length > 0)}
                onLoadMore={segment.isInitial ? semantic.loadMore : undefined}
                scrollRoot={scrollRoot}
                slotPrefix={slotPrefix}
                feedCols={feedCols}
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
    </FeedWhyProvider>
  );
}

// Memoized — the feed lives in the always-mounted shell, so without this
// it re-rendered (and re-ran its derived-list useMemos) on every parent
// render, e.g. each keystroke in search. Props are now referentially
// stable (bookmarks is useMemo'd; callbacks are useCallback'd).
export default memo(ContinuousFeed);
