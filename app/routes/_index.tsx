import { useState, useCallback, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { useLocation } from '@remix-run/react';
import PasswordGate from '~/components/PasswordGate';
import WaitlistScreen from '~/components/WaitlistScreen';
import SplashScreen from '~/components/SplashScreen';
import ContinuousFeed from '~/components/ContinuousFeed';
import BottomBar from '~/components/BottomBar';
import { TrailVideoHost } from '~/components/TrailVideoHost';
import { TrailRoot } from '~/components/TrailMotion';
import CatalogLogo from '~/components/CatalogLogo';
import UserMenu from '~/components/UserMenu';
import { Look, Product } from '~/data/looks';
import { useBookmarks } from '~/hooks/useBookmarks';
import { useRecentProducts } from '~/hooks/useRecentProducts';
import { useAuth } from '~/hooks/useAuth';
import { useOverlayRouter } from '~/hooks/useOverlayRouter';
import { useShellBridge } from '~/hooks/useShellBridge';
import { useAppView } from '~/hooks/useAppView';
import { useSearchUrlSync } from '~/hooks/useSearchUrlSync';
import { useShopperGender } from '~/hooks/useShopperGender';
import { toCatalogName, getRandomCatalogName } from '~/utils/catalogName';
import { prefetchSimilarCreatives, prefetchCreativesByBrand, prefetchHomeFeed, type ProductAd } from '~/services/product-creative';
import { getLooks } from '~/services/looks';
import { primeTrailAssets } from '~/utils/trailPrefetch';
import { supabase } from '~/utils/supabase';
import { trackClick } from '~/services/session-tracker';
import { registerAssetCache, maybeUnregisterSW } from '~/utils/registerSW';

// Modal/overlay surfaces split into their own chunks. None of these are part
// of first paint - the user has to tap into them. Splitting trims the
// consumer's initial bundle without delaying anything they actually see on
// load. Each lazy chunk is wrapped in <Suspense> below.
//
// Importer fns are kept around so we can fire them again from an idle
// callback after first paint - that way the bytes are already in the
// browser cache by the time the user actually opens an overlay.
const importLandingPage = () => import('~/components/LandingPage');
const importCreatorPage = () => import('~/components/CreatorPage');
const importBrandPage = () => import('~/components/BrandPage');
const importBookmarksPage = () => import('~/components/BookmarksPage');
const importProductPage = () => import('~/components/ProductPage');
const importLookOverlay = () => import('~/components/LookOverlay');
const importInAppBrowser = () => import('~/components/InAppBrowser');
const importMyLooks = () => import('~/components/MyLooks');
const importCreatorWallet = () => import('~/components/CreatorWallet');

const LandingPage = lazy(importLandingPage);
const CreatorPage = lazy(importCreatorPage);
const BrandPage = lazy(importBrandPage);
const BookmarksPage = lazy(importBookmarksPage);
const ProductPage = lazy(importProductPage);
const LookOverlay = lazy(importLookOverlay);
const InAppBrowser = lazy(importInAppBrowser);
const MyLooks = lazy(importMyLooks);
const CreatorWallet = lazy(importCreatorWallet);

// Order chosen by likelihood the user will open the surface in the next
// minute: looks/products dominate, browser is the most-visited tail action,
// MyLooks is admin-ish so it's last.
const IDLE_PREFETCH_ORDER: Array<() => Promise<unknown>> = [
  importLookOverlay,
  importProductPage,
  importInAppBrowser,
  importBookmarksPage,
  importCreatorPage,
  importLandingPage,
  importMyLooks,
];

function prefetchOverlayChunks() {
  if (typeof window === 'undefined') return;
  const ric = (window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  }).requestIdleCallback;
  // Fire imports one at a time inside successive idle windows so we don't
  // saturate the network during the user's first interaction with the feed.
  let i = 0;
  const tick = () => {
    if (i >= IDLE_PREFETCH_ORDER.length) return;
    IDLE_PREFETCH_ORDER[i++]().catch(() => { /* network errors retry on real open */ });
    if (ric) ric(tick, { timeout: 2000 });
    else window.setTimeout(tick, 250);
  };
  if (ric) ric(tick, { timeout: 2000 });
  else window.setTimeout(tick, 800);
}

export default function Home() {
  const bookmarks = useBookmarks();
  const { recentProducts, pushRecent } = useRecentProducts();
  const { user, loading: authLoading, logout } = useAuth();

  // Top-level view state machine (locked / splash / landing / app /
  // waitlisted) + the two splash overlays (first-visit branded splash
  // and the auth-resolving fade). See useAppView.
  const {
    view,
    setView,
    firstVisit,
    showSplash,
    setShowSplash,
    authSplashMounted,
    authSplashLeaving,
  } = useAppView({ user, authLoading });

  const [selectedLook, setSelectedLook] = useState<Look | null>(null); // kept for BookmarksPage/CreatorPage overlays
  const [creatorFilter, setCreatorFilter] = useState<string | null>(null);
  const [brandFilter, setBrandFilter] = useState<string | null>(null);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showMyLooks, setShowMyLooks] = useState(false);
  const [showWallet, setShowWallet] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedCreative, setSelectedCreative] = useState<ProductAd | null>(null);
  const [selectedSimilar, setSelectedSimilar] = useState<Product[] | null>(null);
  const [similarCreatives, setSimilarCreatives] = useState<ProductAd[] | null>(null);
  const [brandCreatives, setBrandCreatives] = useState<ProductAd[] | null>(null);
  // Popular-product fallback for the "More like this" feed. Populated
  // once on mount; used when find_similar_creatives returns nothing for
  // a given seed (e.g. cold-start product with no embedding yet).
  const [popularFallback, setPopularFallback] = useState<ProductAd[]>([]);
  // Tracks the look the user was viewing when they opened a product, so
  // pressing back on the product returns to that look instead of the feed.
  const [productOpenedFromLook, setProductOpenedFromLook] = useState<Look | null>(null);
  // Editorial looks pulled from looks_creative; fed into the "You might also
  // like" grid on ProductPage. Loaded once at mount and reused.
  const [liveLooks, setLiveLooks] = useState<Look[]>([]);
  // Nav counter - incremented on every product/creative open. ProductPage
  // useLayoutEffect's on it (not on brand+name) so the scroll-to-top is
  // guaranteed to fire on every trail step, even if two consecutive
  // products share a brand+name or React batches the re-render in a way
  // that makes the field-comparison deps appear unchanged.
  const [productNavCount, setProductNavCount] = useState(0);
  // Gender filter ('all' | 'men' | 'women') + profile-driven auto-sync.
  // changeFilter locks the user-override flag so the auto-sync never
  // clobbers an explicit toggle. lockOverride() lets handleOpenBrand
  // mark override without flipping the filter value.
  const {
    activeFilter,
    changeFilter: handleGenderFilterChange,
    lockOverride: lockGenderOverride,
    resetFilter: resetGenderFilter,
  } = useShopperGender({ user, authLoading });
  // Search query + ?q= URL sync, including the bump-trigger that lets
  // Enter/suggestion-click bypass the in-feed typing debounce. See
  // useSearchUrlSync.
  const { searchQuery, setSearchQuery, searchTrigger, bumpSearchTrigger } = useSearchUrlSync();
  const [searchLoading, setSearchLoading] = useState(false);
  const handleSearchLoadingChange = useCallback((loading: boolean) => {
    setSearchLoading(loading);
  }, []);

  const [isLightMode, setIsLightMode] = useState(false);
  const [shuffleKey, setShuffleKey] = useState(1);
  const [layoutMode, setLayoutMode] = useState(2);
  const [catalogName, setCatalogName] = useState<string>('all');

  // Native shell bridge: Flutter wrapper dispatches CustomEvents on
  // `window` to drive the feed. See useShellBridge / CLAUDE.md Section 8.
  useShellBridge({
    onSetCategory: useCallback((detail: string) => {
      setSearchQuery('');
      resetGenderFilter();
      setCatalogName(detail);
      setShuffleKey(k => k + 1);
      setView('app');
    }, []),
    onOpenBookmarks: useCallback(() => {
      history.pushState({}, '', '/bookmarks');
      setShowBookmarks(true);
    }, []),
    onOpenMyLooks: useCallback(() => {
      history.pushState({}, '', '/my-looks');
      setShowMyLooks(true);
    }, []),
  });

  const handleWaitlistApproved = useCallback(() => {
    setView('app');
  }, []);

  const handleRemix = useCallback(() => {
    setShuffleKey(k => k + 1);
    setLayoutMode(m => (m % 3) + 1);
    setCatalogName(getRandomCatalogName());
  }, []);

  // Right-click snaps the grid back to the default uniform layout (mosaic
  // mode 0) without changing the shuffle seed, so you can escape a wild
  // editorial/spotlight arrangement with one gesture.
  const handleRemixReset = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setLayoutMode(0);
  }, []);

  const handleLogoClick = useCallback(() => {
    // Reset every layer that could be sitting on top of the feed:
    // search query + filters, all modal overlays (product, look,
    // brand, creator, bookmarks, my-looks). Then bump shuffleKey
    // so the feed re-rolls to a fresh order, and dispatch a
    // 'catalog:close-search' event so BottomBar can drop its
    // local searchOpen state (the suggestions column).
    setSearchQuery('');
    resetGenderFilter();
    setCreatorFilter(null);
    setBrandFilter(null);
    setSelectedProduct(null);
    setSelectedCreative(null);
    setSelectedLook(null);
    setShowBookmarks(false);
    setShowMyLooks(false);
    setShuffleKey(k => k + 1);
    setCatalogName('all');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('catalog:close-search'));
      // Push the URL bar back to "/" so clicking the logo from a
      // deep-linked surface (/l/<look-slug>, /p/<product-slug>,
      // /b/<brand-slug>, or /?q=<search>) cleanly resets to the
      // catalog root. Bypasses a full page reload - we already
      // reset every layer of state above, so a silent pushState
      // is enough to keep the URL bar honest.
      const target = '/';
      if (window.location.pathname !== target || window.location.search) {
        window.history.pushState({}, '', target);
      }
      // Scroll to top of the feed so the user lands at the start
      // of the grid, not wherever they were last reading.
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const handleLandingToApp = useCallback(() => {
    setShowSplash(true);
    setView('splash');
    setTimeout(() => {
      setView('app');
      setShowSplash(false);
    }, 1200);
  }, []);

  const handleOpenLook = useCallback((look: Look) => {
    // Trail navigation - when the user opens a look from inside a
    // ProductPage (or any other product overlay), close the product
    // surface so LookOverlay takes its place cleanly. Without this,
    // the two overlays stack and "back" walks through both layers
    // instead of returning to the feed grid where the trail started.
    setSelectedProduct(null);
    setSelectedCreative(null);
    setSelectedSimilar(null);
    setSimilarCreatives(null);
    setBrandCreatives(null);
    // The user is committing to this new look - drop any stale "go
    // back to the previous look on close" so opening a product from
    // here doesn't bounce them somewhere unexpected.
    setProductOpenedFromLook(null);
    // Fire-and-forget click telemetry for /admin/analytics. No-op for
    // unauthenticated visitors (session tracker isn't running).
    trackClick({ type: 'look', id: String(look.id ?? ''), context: look.title?.slice(0, 200) });
    setSelectedLook(look);
  }, []);

  const handleCloseLook = useCallback(() => {
    setSelectedLook(null);
  }, []);

  const handleOpenCreator = useCallback((creatorName: string) => {
    setSelectedLook(null);
    setCreatorFilter(creatorName);
  }, []);

  const handleCloseCreator = useCallback(() => {
    setCreatorFilter(null);
  }, []);

  // Brand catalog overlay. Opening from a product detail (or any
  // higher-stacked modal) closes those overlays so the new brand
  // catalog comes to the foreground. Without this, a tap on the
  // brand label inside ProductPage would silently update the
  // BrandPage *underneath* the still-visible ProductPage.
  const handleOpenBrand = useCallback((brandName: string) => {
    if (!brandName) return;
    // Close any open overlays so the feed below is the visible surface,
    // then push the brand name into the search bar. The feed treats a
    // brand match as a Tier-1 catalog hit and renders the brand's
    // products inline. The ?q= URL effect picks this up and pushes a
    // history entry so the back button returns the user to wherever
    // they came from. We also bump searchTrigger so the feed fires the
    // search immediately instead of waiting on the typing debounce.
    setSelectedProduct(null);
    setSelectedCreative(null);
    setSelectedLook(null);
    setBrandFilter(null);
    setSearchQuery(brandName);
    setCatalogName(toCatalogName(brandName));
    bumpSearchTrigger();
    lockGenderOverride();
  }, [bumpSearchTrigger, lockGenderOverride]);

  const handleCloseBrand = useCallback(() => {
    setBrandFilter(null);
  }, []);

  // In-app browser state. Carries the optional product context so the
  // browser header can show a Save chip wired to bookmarks while the
  // shopper is on the retailer page.
  const [browserState, setBrowserState] = useState<{ url: string; title: string; product?: Product } | null>(null);

  const handleOpenBrowser = useCallback((url: string, title: string, product?: Product) => {
    if (!url) return;
    setBrowserState({ url, title, product });
  }, []);

  // Pull a "like-kinded" feed for the product page. Union of two signals:
  //   1. same brand
  //   2. shared catalog_tags (if any)
  // Both queries are capped and then merged + deduped client-side so the
  // feed still shows something when one bucket is empty.
  const fetchSimilarProducts = useCallback(async (brand: string | null, catalogTags: string[] | null, excludeId: string | null): Promise<Product[]> => {
    if (!supabase) return [];

    type Row = { id: string; name: string | null; brand: string | null; price: string | null; image_url: string | null; url: string | null };
    const queries: Array<Promise<Row[]>> = [];

    if (brand) {
      queries.push((async () => {
        let q = supabase!
          .from('products')
          .select('id, name, brand, price, image_url, url')
          .eq('is_active', true)
          .eq('brand', brand)
          .limit(18);
        if (excludeId) q = q.neq('id', excludeId);
        const { data } = await q;
        return (data || []) as Row[];
      })());
    }

    if (catalogTags && catalogTags.length > 0) {
      queries.push((async () => {
        let q = supabase!
          .from('products')
          .select('id, name, brand, price, image_url, url')
          .eq('is_active', true)
          .overlaps('catalog_tags', catalogTags)
          .limit(18);
        if (excludeId) q = q.neq('id', excludeId);
        const { data } = await q;
        return (data || []) as Row[];
      })());
    }

    if (queries.length === 0) return [];

    const buckets = await Promise.all(queries);
    const seen = new Set<string>();
    const merged: Product[] = [];
    for (const bucket of buckets) {
      for (const row of bucket) {
        if (!row.id || seen.has(row.id)) continue;
        seen.add(row.id);
        merged.push({
          name: row.name || '',
          brand: row.brand || '',
          price: row.price || '',
          url: row.url || '',
          image: row.image_url || undefined,
        });
      }
    }
    return merged.slice(0, 24);
  }, []);

  const handleOpenProduct = useCallback(async (product: Product) => {
    pushRecent(product);
    setProductNavCount(c => c + 1);
    // Remember the look the user came from (if any) so the back button
    // on ProductPage returns to that look instead of the empty feed.
    setProductOpenedFromLook(selectedLook);
    setSelectedLook(null);
    setSelectedCreative(null);
    setSelectedProduct(product);
    setSelectedSimilar(null);
    setSimilarCreatives(null);
    setBrandCreatives(null);
    if (product.brand) {
      const sim = await fetchSimilarProducts(product.brand, null, null);
      setSelectedSimilar(sim);
      // Same data the brand rail uses to fill "More from <Brand>"  - 
      // without this, products opened from a Look, search, or recents
      // see an empty rail.
      prefetchCreativesByBrand(product.brand, null, 12)
        .then(rows => {
          primeTrailAssets(rows);
          setBrandCreatives(rows);
        })
        .catch(() => { /* leave rail empty rather than throw */ });
    }
  }, [fetchSimilarProducts, pushRecent, selectedLook]);

  const lastOpenAtRef = useRef(0);
  const handleOpenCreative = useCallback(async (creative: ProductAd) => {
    if (!creative.product) return;
    // Debounce: while the morph is still in flight (~360ms), ignore extra
    // taps. Without this, a user double-tapping a card double-fires
    // setSelectedCreative which races the layoutId animation and produces a
    // jitter. 240ms gives a 100ms head-start grace beyond morph end.
    const now = performance.now();
    if (now - lastOpenAtRef.current < 240) return;
    lastOpenAtRef.current = now;

    const mapped: Product = {
      name: creative.product.name || 'Shop Now',
      brand: creative.product.brand || '',
      price: creative.product.price || '',
      url: creative.product.url || '',
      image: creative.product.image_url || undefined,
    };
    pushRecent(mapped);
    setProductNavCount(c => c + 1);
    setProductOpenedFromLook(selectedLook);
    setSelectedLook(null);
    setSelectedProduct(mapped);
    setSelectedCreative(creative);
    // Don't blank the rail state here - that would unmount the tapped rail
    // card the very moment Framer Motion is reading its layoutId for the
    // morph, which produces a glitched/jumping transition. Keep the old
    // rails visible; the .then() handlers below overwrite once new data
    // arrives. If the prefetch was already done (likely, because tapping
    // the card means the user hovered/touched it which fired prefetch),
    // the swap is effectively instant.

    // Three lookups, all eager. Each is independently primed so the user's
    // hover often resolves them before they actually tap.
    const simP = fetchSimilarProducts(
      creative.product.brand || null,
      creative.product.catalog_tags || null,
      creative.product.id || null,
    );
    const similarP = prefetchSimilarCreatives(creative.id, 18, creative.product?.type ?? null);
    const brandP = creative.product.brand
      ? prefetchCreativesByBrand(creative.product.brand, creative.product.id || null, 12)
      : Promise.resolve([] as ProductAd[]);

    // Overwrite when data arrives. No intermediate null state - old rail
    // content stays put through the morph and gets replaced atomically.
    similarP.then(rows => {
      primeTrailAssets(rows);
      setSimilarCreatives(rows);
    }).catch(() => { /* keep rail empty rather than throw */ });

    brandP.then(rows => {
      primeTrailAssets(rows);
      setBrandCreatives(rows);
    }).catch(() => { /* keep brand rail empty rather than throw */ });

    simP.then(setSelectedSimilar).catch(() => { /* leave brand fallback empty */ });
  }, [fetchSimilarProducts, pushRecent, selectedLook]);

  // Editorial looks for the "You might also like" grid on ProductPage. One
  // fetch per session; reused across every overlay open.
  useEffect(() => {
    let cancelled = false;
    getLooks().then(rows => { if (!cancelled) setLiveLooks(rows); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Popular fallback - fetch the live-ads roster once so the "More like
  // this" feed can fill from it whenever the similar-by-embedding
  // lookup returns nothing for the active product.
  useEffect(() => {
    let cancelled = false;
    prefetchHomeFeed()
      .then(rows => {
        if (cancelled) return;
        primeTrailAssets(rows.slice(0, 32));
        setPopularFallback(rows);
      })
      .catch(() => { /* leave fallback empty rather than throw */ });
    return () => { cancelled = true; };
  }, []);

  // Curated subset for the "You might also like" grid. Drops legacy seed
  // rows whose video field is a bare filename (e.g. "guy.mp4" / "girl2.mp4"
  // from migration 002 - those assets aren't deployed and render as empty
  // black tiles named "Look 02"/"Look 06"/etc.) and dedupes by video URL so
  // the same clip can't show up multiple times in a row.
  const lookFeedTiles = useMemo<Look[]>(() => {
    // Skip stub seed rows whose video field is a bare filename. Then
    // dedupe by look identity (uuid/id) and by (creator + video) so a
    // single creator who uploaded the same video to multiple look rows
    // doesn't fill the rail. Different creators using the same video
    // stay distinct, so creator labels never get swapped.
    const seenIds = new Set<string>();
    const seenCreatorVideo = new Set<string>();
    const out: Look[] = [];
    for (const l of liveLooks) {
      const video = l.video || '';
      if (!/^https?:\/\//i.test(video)) continue;
      const idKey = String(l.uuid || l.id);
      if (seenIds.has(idKey)) continue;
      const creatorVideoKey = `${l.creator}|${video}`;
      if (seenCreatorVideo.has(creatorVideoKey)) continue;
      seenIds.add(idKey);
      seenCreatorVideo.add(creatorVideoKey);
      out.push(l);
      // Bumped from 12 to 24 so the "Featured in these looks" rail
      // surfaces the full published-look feed, not a curated subset.
      if (out.length >= 24) break;
    }
    return out;
  }, [liveLooks]);

  const handleCreateCatalog = useCallback((query: string) => {
    setSelectedProduct(null);
    setSelectedLook(null);
    setSearchQuery(query);
    // The catalog name is the user's actual query, title-cased - so a
    // search for "omg shoes" surfaces as "OMG Shoes" under the logo.
    // Single short tokens (acronyms) stay uppercase.
    const trimmed = query.trim();
    setCatalogName(trimmed ? toCatalogName(trimmed) : 'all');
  }, []);

  // The TypeAnywhere overlay (mounted in root.tsx) lands new
  // searches on /?q=<query>. Read the param on every URL change,
  // apply it, then strip it so refresh / share doesn't re-fire.
  // Also forces view='app' so the user lands on the grid even if
  // they were on the landing page or password gate.
  const location = useLocation();
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(location.search);
    const q = params.get('q');
    if (!q) return;
    // Don't fire the search while supabase-js is mid-OAuth callback.
    // The URL during that window has both ?q=… (carried through from
    // the page the user signed in from) and ?code=… (the OAuth code
    // supabase-js is about to exchange). Stripping ?q= before exchange
    // would leave the user pointed at a search they didn't run; running
    // the search before exchange races the SIGNED_IN event. Skip until
    // the auth listener clears the code from the URL, then this effect
    // re-runs on the next location update.
    if (params.has('code') || params.has('error_description')) return;
    handleCreateCatalog(q);
    bumpSearchTrigger();
    setView('app');
    params.delete('q');
    const remaining = params.toString();
    const url = `${window.location.pathname}${remaining ? `?${remaining}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, '', url);
  }, [location.search, handleCreateCatalog]);

  const toggleTheme = useCallback(() => {
    setIsLightMode(prev => !prev);
  }, []);

  // Header / BottomBar / UserMenu callbacks. Stable refs so the memo
  // wrappers on BottomBar and UserMenu actually cut renders - inline
  // arrow functions in JSX would create new identities every render.
  const openBookmarks = useCallback(() => setShowBookmarks(true), []);
  const openMyLooks = useCallback(() => setShowMyLooks(true), []);
  const openWallet = useCallback(() => setShowWallet(true), []);
  const closeBookmarks = useCallback(() => {
    history.replaceState({}, '', '/#app');
    setShowBookmarks(false);
  }, []);
  const closeMyLooks = useCallback(() => {
    history.replaceState({}, '', '/#app');
    setShowMyLooks(false);
  }, []);
  const closeWallet = useCallback(() => {
    history.replaceState({}, '', '/#app');
    setShowWallet(false);
  }, []);
  const handleLogout = useCallback(async () => {
    await logout();
    setView('locked');
  }, [logout]);
  const handleSearchChange = useCallback((q: string) => {
    setSearchQuery(q);
    setCatalogName(q.trim() ? toCatalogName(q) : 'all');
  }, []);
  const handleSelectSuggestion = useCallback((q: string) => {
    setSearchQuery(q.toLowerCase());
    setCatalogName(toCatalogName(q));
    bumpSearchTrigger();
  }, []);
  const handleOpenLilyCreator = useCallback(() => setCreatorFilter('@lilywittman'), []);
  const handleProductClose = useCallback(() => {
    setSelectedProduct(null);
    setSelectedCreative(null);
    setSelectedSimilar(null);
    setSimilarCreatives(null);
    setBrandCreatives(null);
    // If the product was opened from a look, restore that look so the
    // back button feels like back-navigation. Otherwise fall through to
    // the feed and pop /p/<slug> from the URL.
    if (productOpenedFromLook) {
      setSelectedLook(productOpenedFromLook);
      setProductOpenedFromLook(null);
      return;
    }
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/p/')) {
      window.history.replaceState({}, '', '/');
    }
  }, [productOpenedFromLook]);

  // URL ↔ overlay state binding: push /p/<slug>, /l/<slug>, /b/<slug>
  // when an overlay opens, and consume the slug on fresh load. See
  // useOverlayRouter for the full sync contract.
  useOverlayRouter({
    selectedProduct,
    selectedLook,
    brandFilter,
    onOpenProduct: handleOpenProduct,
    onOpenLook: handleOpenLook,
    onOpenBrand: handleOpenBrand,
  });

  const handleBookmarksOpenCreator = useCallback((handle: string) => {
    history.replaceState({}, '', '/#app');
    setShowBookmarks(false);
    handleOpenCreator(handle);
  }, [handleOpenCreator]);
  const handleBrowserClose = useCallback(() => setBrowserState(null), []);

  // Derived list - depends on liveLooks (changes once on mount) and
  // bookmarkedLooks (changes only on bookmark toggle). Memoizing keeps
  // UserMenu's savedLooks prop stable across unrelated re-renders.
  const savedLooksForMenu = useMemo(
    () => liveLooks.filter(l => bookmarks.bookmarkedLooks.includes(l.id)),
    [liveLooks, bookmarks.bookmarkedLooks],
  );

  const isAppVisible = view === 'app';

  // Once the user is in the main app, kick off background imports of every
  // overlay chunk on idle. By the time they tap a card or open bookmarks,
  // the chunk is already cached and the surface opens with no delay.
  useEffect(() => {
    if (!isAppVisible) return;
    prefetchOverlayChunks();
  }, [isAppVisible]);

  // One-shot service-worker registration. Skipped on localhost (dev), and
  // honors a ?sw-off escape hatch in case the cache ever needs purging.
  useEffect(() => {
    maybeUnregisterSW();
    registerAssetCache();
  }, []);

  // Trail depth: while the product/look overlay is open, the under-layer
  // (header + grid) recedes a hair (scale 0.985, 4px blur). Subtle parallax
  // that signals "what you tapped is now the focus" without feeling theatrical.
  const overlayOpen = !!selectedProduct || !!selectedLook;

  return (
    <TrailRoot>
    <TrailVideoHost>
    <div className={`app-root ${isLightMode ? 'light-mode' : ''}${overlayOpen ? ' has-overlay' : ''}`}>
      {/* Branded splash while auth is resolving. Stays mounted for one
          extra fade-out tick after auth resolves, so the gate or app
          underneath cross-fades in instead of snapping. */}
      {authSplashMounted && (
        <div className={`auth-splash${authSplashLeaving ? ' leaving' : ''}`} aria-hidden="true">
          <CatalogLogo className="auth-splash-logo" />
        </div>
      )}
      {view === 'locked' && !authLoading && !user && <PasswordGate />}
      {view === 'waitlisted' && user && (
        <WaitlistScreen user={user} onApproved={handleWaitlistApproved} />
      )}

      {showSplash && <SplashScreen />}
      {firstVisit && <SplashScreen />}

      {view === 'landing' && (
        <Suspense fallback={null}>
          <LandingPage onStartBrowsing={handleLandingToApp} />
        </Suspense>
      )}

      {isAppVisible && (
        <>
          {/* Top search loading bar - thin shimmer across the very top of the viewport */}
          <div className={`search-loading-bar${searchLoading ? ' visible' : ''}`} aria-hidden="true" />

          <header>
            <div className="header-left">
              <button className="logo-btn" onClick={handleLogoClick} aria-label="Home">
                <CatalogLogo className="logo" />
                {catalogName && catalogName !== 'all' && (
                  <span className="logo-catalog-name">{catalogName}</span>
                )}
              </button>
            </div>
            <div className="header-right">
              <button className="bookmark-toggle" onClick={openBookmarks} aria-label="Bookmarks">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                {bookmarks.totalCount > 0 && <span className="bookmark-count">{bookmarks.totalCount}</span>}
              </button>
              <UserMenu
                onOpenBookmarks={openBookmarks}
                onOpenMyLooks={openMyLooks}
                onOpenWallet={openWallet}
                bookmarkCount={bookmarks.totalCount}
                user={user}
                onLogout={handleLogout}
                recentProducts={recentProducts}
                savedProducts={bookmarks.bookmarkedProducts}
                savedLooks={savedLooksForMenu}
                onOpenLook={handleOpenLook}
                onOpenProduct={handleOpenProduct}
                activeFilter={activeFilter}
                onChangeCatalogGender={handleGenderFilterChange}
              />
            </div>
          </header>

          <ContinuousFeed
            activeFilter={activeFilter}
            searchQuery={searchQuery}
            shuffleKey={shuffleKey}
            layoutMode={layoutMode}
            onOpenLook={handleOpenLook}
            onOpenCreator={handleOpenCreator}
            onOpenBrowser={handleOpenBrowser}
            onOpenProduct={handleOpenProduct}
            onOpenCreative={handleOpenCreative}
            onOpenBrand={handleOpenBrand}
            onCreateCatalog={handleCreateCatalog}
            bookmarks={bookmarks}
            onSearchLoadingChange={handleSearchLoadingChange}
            searchTrigger={searchTrigger}
          />

          <BottomBar
            activeFilter={activeFilter}
            onFilterChange={handleGenderFilterChange}
            searchQuery={searchQuery}
            onSearchChange={handleSearchChange}
            onSelectSuggestion={handleSelectSuggestion}
            onOpenCreators={handleOpenLilyCreator}
            catalogName={catalogName}
            searchLoading={searchLoading}
          />

          <button className="remix-btn-fixed" onClick={handleRemix} onContextMenu={handleRemixReset} title="Click to remix · Right-click to reset layout" aria-label="Remix">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          </button>

          {/* LookOverlay for grid look taps */}
          {selectedLook && (
            <Suspense fallback={null}>
              <LookOverlay
                look={selectedLook}
                onClose={handleCloseLook}
                onOpenCreator={handleOpenCreator}
                onOpenBrowser={handleOpenBrowser}
                onOpenProduct={handleOpenProduct}
                onCreateCatalog={handleCreateCatalog}
                onOpenLook={handleOpenLook}
                bookmarks={bookmarks}
              />
            </Suspense>
          )}

          {creatorFilter && (
            <Suspense fallback={null}>
              <CreatorPage
                creatorName={creatorFilter}
                onClose={handleCloseCreator}
                onOpenLook={handleOpenLook}
                onOpenProduct={handleOpenProduct}
                onOpenBrowser={handleOpenBrowser}
                onCreateCatalog={handleCreateCatalog}
              />
            </Suspense>
          )}

          {brandFilter && (
            <Suspense fallback={null}>
              <BrandPage
                brandName={brandFilter}
                onClose={handleCloseBrand}
                onOpenProduct={handleOpenCreative}
              />
            </Suspense>
          )}

          {showBookmarks && (
            <Suspense fallback={null}>
              <BookmarksPage
                bookmarks={bookmarks}
                onClose={closeBookmarks}
                onOpenLook={handleOpenLook}
                onOpenBrowser={handleOpenBrowser}
                onOpenCreator={handleBookmarksOpenCreator}
                onOpenBrand={handleOpenBrand}
              />
            </Suspense>
          )}

          {showMyLooks && (
            <Suspense fallback={null}>
              <MyLooks onClose={closeMyLooks} />
            </Suspense>
          )}

          {showWallet && (
            <div className="my-looks-overlay">
              <div className="my-looks-container">
                <div className="my-looks-header">
                  <div className="my-looks-header-left">
                    <button className="my-looks-back" onClick={closeWallet} aria-label="Back">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
                      </svg>
                    </button>
                    <h1 className="my-looks-title">Wallet</h1>
                  </div>
                </div>
                <div style={{ padding: '20px 16px', overflowY: 'auto', flex: 1 }}>
                  <Suspense fallback={<div style={{ padding: 32, textAlign: 'center', color: '#888', fontSize: 14 }}>Loading wallet…</div>}>
                    <CreatorWallet />
                  </Suspense>
                </div>
              </div>
            </div>
          )}

          {selectedProduct && (
            <Suspense fallback={null}>
              <ProductPage
                product={selectedProduct}
                onClose={handleProductClose}
                onOpenLook={handleOpenLook}
                onOpenBrowser={handleOpenBrowser}
                onOpenProduct={handleOpenProduct}
                onOpenCreator={handleOpenCreator}
                onOpenCreative={handleOpenCreative}
                onOpenBrand={handleOpenBrand}
                creative={
                  selectedCreative?.video_url
                    ? { id: selectedCreative.id, videoUrl: selectedCreative.video_url, thumbnailUrl: selectedCreative.thumbnail_url }
                    : undefined
                }
                similarCreatives={similarCreatives ?? undefined}
                brandCreatives={brandCreatives ?? undefined}
                popularFallback={popularFallback}
                lookCreatives={lookFeedTiles}
                bookmarks={bookmarks}
                navKey={productNavCount}
              />
            </Suspense>
          )}

        </>
      )}

      {browserState && (
        <Suspense fallback={null}>
          <InAppBrowser
            url={browserState.url}
            title={browserState.title}
            product={browserState.product}
            isSaved={browserState.product ? bookmarks.isProductBookmarked(browserState.product) : undefined}
            onToggleSave={browserState.product ? bookmarks.toggleProductBookmark : undefined}
            onClose={handleBrowserClose}
          />
        </Suspense>
      )}
    </div>
    </TrailVideoHost>
    </TrailRoot>
  );
}
