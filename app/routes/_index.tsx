import { useState, useCallback, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { useLocation, useNavigate } from '@remix-run/react';
import PasswordGate from '~/components/PasswordGate';
import WaitlistScreen from '~/components/WaitlistScreen';
import SplashScreen from '~/components/SplashScreen';
import ShoppingForHero from '~/components/home/ShoppingForHero';
import SearchCeremony from '~/components/home/SearchCeremony';
import SplashHost from '~/components/splash/SplashHost';
import { getSplashConfig, DEFAULT_SPLASH_CONFIG, type SplashConfig } from '~/services/splash-config';
import ContinuousFeed from '~/components/ContinuousFeed';
import SiteParticleHost from '~/components/SiteParticleHost';
import ParticleBackground from '~/components/ParticleBackground';
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
import { prefetchSimilarProducts, prefetchCreativesByBrand, prefetchHomeFeed, type ProductAd } from '~/services/product-creative';
import { getGraphPairs, type GraphPair } from '~/services/graph-pairs';
import { getLooks } from '~/services/looks';
import { primeTrailAssets } from '~/utils/trailPrefetch';
import { supabase } from '~/utils/supabase';
import { trackClick, trackCreativeImpressions, resolveProductIdByUrl, trackProductClickout } from '~/services/session-tracker';
import { registerAssetCache, maybeUnregisterSW } from '~/utils/registerSW';
import HeaderWalletPill from '~/components/HeaderWalletPill';
import HeaderActivityPill from '~/components/HeaderActivityPill';
import FollowingRail from '~/components/FollowingRail';
import PendingLookPill from '~/components/PendingLookPill';
import ActivityRealtimeToasts from '~/components/ActivityRealtimeToasts';

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
const importProfilePage = () => import('~/components/ProfilePage');
const importFollowingPage = () => import('~/components/FollowingPage');

const LandingPage = lazy(importLandingPage);
const CreatorPage = lazy(importCreatorPage);
const BrandPage = lazy(importBrandPage);
const BookmarksPage = lazy(importBookmarksPage);
const ProductPage = lazy(importProductPage);
const LookOverlay = lazy(importLookOverlay);
const InAppBrowser = lazy(importInAppBrowser);
const MyLooks = lazy(importMyLooks);
const CreatorWallet = lazy(importCreatorWallet);
const ProfilePage = lazy(importProfilePage);
const FollowingPage = lazy(importFollowingPage);
// Shared Saved screen, embedded into My Account + My Catalog. Lazy so it
// only loads when a saved surface actually mounts.
const SavedScreen = lazy(() => import('~/components/SavedScreen'));
// Comment thread, rendered as an in-app overlay (not a route) so backing
// out of it never tears down / re-resolves the product or look underneath.
const CommentsPage = lazy(() => import('~/components/CommentsPage'));

/** Pause every currently-playing <video> in the document. Called on
 *  every product → product navigation so the old hero + rail cards
 *  don't keep decoding while the new page mounts. The
 *  IntersectionObserver-driven autoplay in cards will resume whichever
 *  videos are actually on screen once the new layout settles. */
function pauseAllVideos(): void {
  if (typeof document === 'undefined') return;
  document.querySelectorAll<HTMLVideoElement>('video').forEach(v => {
    if (!v.paused) {
      try { v.pause(); } catch { /* WebKit can throw on hostile elements; safe to ignore */ }
    }
  });
}

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

// Disable the browser's scroll restoration on the landing page. Default
// 'auto' restores the previous scroll position on F5 / pull-to-refresh
// — which lands the user mid-hero on the home screen. The search bar
// is pinned at bottom: 38vh from the viewport, but every fixed/sticky
// header element above it is measured from "top of document", so a
// mid-page reload offsets the bar off-center until the user scrolls
// back to 0. Owning the restore manually keeps refresh at the top.
if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
  try { window.history.scrollRestoration = 'manual'; } catch { /* Safari edge */ }
}

export default function Home() {
  // Hard scroll-to-top on every Home mount. Pairs with the
  // scrollRestoration='manual' above to neutralise both the browser's
  // restore-on-refresh AND any phantom anchor scroll from a deep-link
  // (/p/, /l/, /b/) being closed back to "/". The bar pin reads off the
  // viewport, so even a 40 px stale scroll throws its visual centering
  // off until the next render.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.scrollTo(0, 0);
  }, []);

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

  // Cinematic cold-open splash. Plays once per fresh app boot (cold
  // open), gated by the /admin/splash config. Distinct from the
  // one-time first-visit SplashScreen — this fires every cold open.
  // Skipped inside the Flutter shell (it draws its own launch screen)
  // and when sessionStorage already marked this tab as opened.
  const [cinematic, setCinematic] = useState<{ active: boolean; config: SplashConfig }>(() => {
    if (typeof window === 'undefined') return { active: false, config: DEFAULT_SPLASH_CONFIG };
    const inShell = document.documentElement.dataset.shell === 'catalog-app';
    let alreadyOpened = false;
    try { alreadyOpened = sessionStorage.getItem('catalog:cold-open-done') === '1'; } catch { /* ignore */ }
    return { active: !inShell && !alreadyOpened, config: DEFAULT_SPLASH_CONFIG };
  });
  useEffect(() => {
    if (!cinematic.active) return;
    try { sessionStorage.setItem('catalog:cold-open-done', '1'); } catch { /* ignore */ }
    // SplashScreen + SplashHost were retired — the big "Catalog" wordmark
    // splash was duplicating the smaller auth-splash above. Drop the
    // cinematic on the next tick and fire the done event so any
    // listeners (ActivityRealtimeToasts, etc.) don't hang waiting for a
    // splash that never paints.
    const t = setTimeout(() => {
      setCinematic(c => ({ ...c, active: false }));
      try { window.dispatchEvent(new Event('catalog:splash-done')); } catch { /* ignore */ }
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [selectedLook, setSelectedLook] = useState<Look | null>(null); // kept for BookmarksPage/CreatorPage overlays
  const [creatorFilter, setCreatorFilter] = useState<string | null>(null);
  const [brandFilter, setBrandFilter] = useState<string | null>(null);
  // "Make a catalog of who I follow" — handles array set when the
  // shopper taps the CTA in the FollowingRail popover. Feeds the
  // home feed through allowedCreatorHandles so only the followed
  // creators' looks surface. null disables the filter.
  const [followingCatalog, setFollowingCatalog] = useState<string[] | null>(null);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showMyLooks, setShowMyLooks] = useState(false);
  const [showWallet, setShowWallet] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showFollowing, setShowFollowing] = useState(false);
  // Sign-in gate overlay. Shown when a signed-out visitor tries to enter
  // the app from the landing — the app is sign-in-only. Cleared the moment
  // a session resolves (the auto-route effect then takes them in).
  const [showSignIn, setShowSignIn] = useState(false);
  useEffect(() => { if (user) setShowSignIn(false); }, [user]);
  // Comment thread overlay target. Opening pushes /comments/<type>/<slug>
  // via history.pushState (NOT a route nav) so the product/look overlay
  // underneath stays mounted; backing out just clears this.
  const [commentsTarget, setCommentsTarget] = useState<{ type: 'product' | 'look'; slug: string } | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedCreative, setSelectedCreative] = useState<ProductAd | null>(null);
  const [selectedSimilar, setSelectedSimilar] = useState<Product[] | null>(null);
  const [similarCreatives, setSimilarCreatives] = useState<ProductAd[] | null>(null);
  const [brandCreatives, setBrandCreatives] = useState<ProductAd[] | null>(null);
  const [graphPairs, setGraphPairs] = useState<GraphPair[] | null>(null);
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
  const [mySizeOnly, setMySizeOnly] = useState(false);

  // ── New home: "What are you shopping for?" hero ──────────────────────
  // The hero is the home entry; the catalog feed lives directly below it
  // (scroll reveals it). A search plays the SearchCeremony then reveals
  // results. Skipped inside the native Flutter shell (it has its own
  // launch UX) and once a search/catalog filter is already active.
  const inShell = typeof document !== 'undefined' && document.documentElement.dataset.shell === 'catalog-app';
  const [heroMode, setHeroMode] = useState(() => !inShell);
  const [heroScrolled, setHeroScrolled] = useState(false);
  const [ceremony, setCeremony] = useState<{ active: boolean; query: string; kind: 'search' | 'brand' }>({ active: false, query: '', kind: 'search' });
  const [revealResults, setRevealResults] = useState(false);
  // Chrome auto-hide on scroll-down once you're past the hero. Header
  // slides up offscreen, bottom search bar slides down — full-screen feed.
  // Scrolling up brings them back; stopping preserves the current state.
  const [chromeHidden, setChromeHidden] = useState(false);

  // Referral capture: stash any ?ref=<handle> from the landing URL ASAP
  // (before OAuth can strip it), then redeem it once the user is signed in
  // (attribute the signup + skip the waitlist + reward the creator $0.25).
  useEffect(() => {
    import('~/services/referrals').then(({ captureRefFromUrl }) => captureRefFromUrl());
  }, []);
  useEffect(() => {
    if (!user) return;
    import('~/services/referrals').then(({ redeemStoredRef }) => { void redeemStoredRef(); });
  }, [user]);

  // Pause the site singleton particle field whenever the feed is the focus
  // (hero dismissed or scrolled past) — it's fully covered there, so drawing
  // it is wasted GPU that competes with video decode on scroll.
  useEffect(() => {
    import('~/services/particles').then(({ particleControls }) => {
      particleControls.paused = !heroMode || heroScrolled;
    });
  }, [heroMode, heroScrolled]);

  // Reveal the bottom search bar once the shopper scrolls down off the
  // hero into the catalog (while heroMode is the active screen). While
  // scrolling within the hero band we also write a 0→1 progress value
  // to --hero-scroll-progress on the app root so CSS can fade the
  // hero-positioned search bar out as the shopper scrolls into the
  // feed peek — without that, the bar hovered awkwardly in the
  // middle of the viewport until the 50% threshold flipped it down
  // to the docked position in one step.
  const [heroBarFaded, setHeroBarFaded] = useState(false);
  useEffect(() => {
    if (!heroMode) {
      setHeroScrolled(true);
      setHeroBarFaded(false);
      if (typeof document !== 'undefined') {
        document.documentElement.style.setProperty('--hero-scroll-progress', '1');
      }
      return;
    }
    setHeroScrolled(false);
    setHeroBarFaded(false);
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--hero-scroll-progress', '0');
    }
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const ratio = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.5)));
        document.documentElement.style.setProperty('--hero-scroll-progress', String(ratio));
        // Same 0.625 cutoff as the CSS opacity formula (1 - r*1.6 ≤ 0)
        // so pointer-events flip off the moment the bar is visually
        // invisible. Without this hook the faded bar still ate taps
        // meant for the product tiles below it.
        setHeroBarFaded(ratio >= 0.625);
        setHeroScrolled(window.scrollY > window.innerHeight * 0.5);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [heroMode]);

  // Scroll-direction tracker: once past the hero, hide chrome on scroll
  // down and show it on scroll up. Small dead-zone so micro-jitter doesn't
  // flicker the chrome. Reset to visible on every overlay open (so the
  // chrome is there when you close back to the feed).
  useEffect(() => {
    if (!heroScrolled) { setChromeHidden(false); return; }
    let lastY = window.scrollY;
    const THRESHOLD = 8; // px of continuous direction before reacting
    let accum = 0;
    const onScroll = () => {
      const y = window.scrollY;
      const dy = y - lastY;
      lastY = y;
      // Always show near the very top.
      if (y < window.innerHeight * 0.6) { setChromeHidden(false); accum = 0; return; }
      // Same direction as accum: extend; opposite direction: reset.
      if ((dy > 0 && accum >= 0) || (dy < 0 && accum <= 0)) accum += dy;
      else accum = dy;
      if (accum > THRESHOLD)       setChromeHidden(true);
      else if (accum < -THRESHOLD) setChromeHidden(false);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [heroScrolled]);

  // Any committed search while on the hero (bottom bar Enter, a catalog
  // pill, the type-anywhere overlay, or a deep-linked ?q=) bumps
  // searchTrigger — that's our single universal cue to play the ceremony,
  // then reveal results. Live typing doesn't bump the trigger, so the
  // hero stays put while the shopper types.
  const prevTriggerRef = useRef(searchTrigger);
  useEffect(() => {
    if (searchTrigger === prevTriggerRef.current) return;
    prevTriggerRef.current = searchTrigger;
    if (heroMode && searchQuery.trim() && !ceremony.active) {
      setCeremony({ active: true, query: searchQuery, kind: 'search' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTrigger]);

  const handleCeremonyDone = useCallback(() => {
    setCeremony({ active: false, query: '', kind: 'search' });
    setHeroMode(false);
    window.scrollTo({ top: 0, behavior: 'auto' });
    setRevealResults(true);
    window.setTimeout(() => setRevealResults(false), 950);
  }, []);

  const handleRevealFeed = useCallback(() => {
    window.scrollTo({ top: window.innerHeight, behavior: 'smooth' });
  }, []);

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

  // Creator engagement toast click → open the wallet and scroll
  // its Analytics section into view. Two rAF frames give setShowWallet
  // time to commit and CreatorWallet time to mount its scroll-target.
  useEffect(() => {
    const onOpenWalletAnalytics = () => {
      setShowWallet(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.dispatchEvent(new CustomEvent('catalog:scroll-wallet-analytics'));
        });
      });
    };
    window.addEventListener('catalog:open-wallet-analytics', onOpenWalletAnalytics);
    return () => {
      window.removeEventListener('catalog:open-wallet-analytics', onOpenWalletAnalytics);
    };
  }, []);

  const handleWaitlistApproved = useCallback(() => {
    setView('app');
  }, []);

  const handleRemix = useCallback(() => {
    // Remix is a VIEW shuffle — re-seeds card order + cycles the grid
    // layout. It used to ALSO rotate the catalog name string, but
    // that turned every remix click into a new catalog, which is the
    // opposite of what the user expects (the remix glyph should
    // refresh the LOOK of the current catalog, not pick a different
    // one). Catalog name stays put now.
    setShuffleKey(k => k + 1);
    setLayoutMode(m => (m % 3) + 1);
  }, []);

  // Right-click snaps the grid back to the default uniform layout (mosaic
  // mode 0) without changing the shuffle seed, so you can escape a wild
  // editorial/spotlight arrangement with one gesture.
  const handleRemixReset = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setLayoutMode(0);
  }, []);

  // Remix navigate is used to reset the URL on logo click so Remix's
  // router-level location stays in sync. A raw window.history.pushState
  // here would desync useLocation() — subsequent searches via the
  // TypeAnywhere overlay (which uses navigate('/?q=…')) would then
  // appear as no-op location changes and silently drop the query.
  const navigate = useNavigate();

  const handleLogoClick = useCallback(() => {
    // Reset every layer that could be sitting on top of the feed:
    // search query + filters, all modal overlays (product, look,
    // brand, creator, bookmarks, my-looks). Then bump shuffleKey
    // so the feed re-rolls to a fresh order, and dispatch a
    // 'catalog:close-search' event so BottomBar can drop its
    // local searchOpen state (the suggestions column).
    // Also return to the "What are you shopping for?" home hero.
    if (!inShell) { setHeroMode(true); window.scrollTo({ top: 0, behavior: 'auto' }); }
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
      // catalog root. Use Remix's navigate (not raw pushState) so
      // useLocation() stays in sync — otherwise re-submitting the
      // same search via the TypeAnywhere overlay would land on the
      // same router-level location and the ?q= effect wouldn't fire.
      const target = '/';
      if (window.location.pathname !== target || window.location.search) {
        navigate(target);
      }
      // Scroll to top of the feed so the user lands at the start
      // of the grid, not wherever they were last reading.
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [navigate]);

  // "Following" catalog pill (desktop search cloud, via TypeAnywhere)
  // hands us the resolved follow handles through a CustomEvent. Scope
  // the feed to them, same as the FollowingRail's CTA.
  useEffect(() => {
    const onFollowingCatalog = (e: Event) => {
      const handles = (e as CustomEvent<{ handles?: string[] }>).detail?.handles ?? [];
      const norm = Array.from(new Set(handles.map(h => h.toLowerCase().trim()).filter(Boolean)));
      if (norm.length === 0) return;
      setFollowingCatalog(norm);
      setCatalogName('Following');
      setCreatorFilter(null);
      setBrandFilter(null);
      setView('app');
    };
    window.addEventListener('catalog:following-catalog', onFollowingCatalog);
    return () => window.removeEventListener('catalog:following-catalog', onFollowingCatalog);
  }, [setView]);

  // Stable callback for the FollowingRail "make a catalog of who I
  // follow" CTA. Defined once (useCallback) so the memoized FollowingRail
  // isn't re-rendered by a fresh arrow identity every parent render.
  const handleCreateFollowingCatalog = useCallback((handles: string[]) => {
    const norm = Array.from(new Set(handles.map(h => h.toLowerCase().trim()).filter(Boolean)));
    if (norm.length === 0) return;
    setFollowingCatalog(norm);
    setCatalogName('Following');
    setCreatorFilter(null);
    setBrandFilter(null);
  }, []);

  const handleLandingToApp = useCallback(() => {
    // The app is sign-in-only. A signed-out visitor tapping "Open the feed"
    // gets the sign-in screen, not free access — closing the landing's old
    // "no signup" hole. Once signed in, the auto-route effect takes them in.
    if (!user) { setShowSignIn(true); return; }
    // Fixed 2000ms beat so the splash feels the same regardless of entry.
    setShowSplash(true);
    setView('splash');
    setTimeout(() => {
      setView('app');
      setShowSplash(false);
    }, 2000);
  }, [user]);

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
    trackClick({ type: 'look', id: String(look.id ?? ''), uuid: look.uuid, context: look.title?.slice(0, 200) });
    setSelectedLook(look);
  }, []);

  const handleCloseLook = useCallback(() => {
    // Same back-button parity as handleProductClose: prefer
    // history.back() so the pushed /l/<slug> entry pops cleanly. The
    // popstate listener at the bottom of this file then clears
    // selectedLook. If we're not on /l/ (cold load / no pushed entry)
    // just clear directly.
    if (typeof window !== 'undefined'
        && window.location.pathname.startsWith('/l/')
        && window.history.length > 1) {
      window.history.back();
      return;
    }
    setSelectedLook(null);
  }, []);

  const handleOpenCreator = useCallback((creatorName: string) => {
    // Close every higher-stacked overlay so the creator catalog comes to
    // the foreground. Without nulling selectedProduct/selectedCreative,
    // a tap on a creator pill inside ProductPage's "You might also like"
    // would update the catalog *underneath* the still-visible product
    // page and the click would look like a no-op. Mirrors the close
    // pattern in handleOpenBrand.
    setSelectedProduct(null);
    setSelectedCreative(null);
    setSelectedLook(null);
    setBrandFilter(null);
    setCreatorFilter(creatorName);
  }, []);

  const handleCloseCreator = useCallback(() => {
    // Prefer history.back() when we landed here via the /c/<slug>
    // push so the close X and the browser back button take the same
    // path. The popstate listener above clears creatorFilter when
    // the URL leaves /c/. Falls back to a direct state clear on cold
    // load (no pushed entry to pop).
    if (typeof window !== 'undefined'
        && window.location.pathname.startsWith('/c/')
        && window.history.length > 1) {
      window.history.back();
      return;
    }
    setCreatorFilter(null);
  }, []);

  // Following list page (mobile rail tap). Opening a creator from it closes
  // the list first so the creator catalog comes to the foreground.
  const openFollowingList = useCallback(() => setShowFollowing(true), []);
  const closeFollowingList = useCallback(() => setShowFollowing(false), []);
  const handleFollowingOpenCreator = useCallback((handle: string) => {
    setShowFollowing(false);
    handleOpenCreator(handle);
  }, [handleOpenCreator]);

  // Brand catalog overlay. Opening from a product detail (or any
  // higher-stacked modal) closes those overlays so the new brand
  // catalog comes to the foreground. Without this, a tap on the
  // brand label inside ProductPage would silently update the
  // BrandPage *underneath* the still-visible ProductPage.
  const handleOpenBrand = useCallback((brandName: string) => {
    if (!brandName) return;
    // Open a brand → play the AI search ceremony FIRST with brand-
    // specific copy ("Finding everything from <Brand>", etc.), then
    // let handleCeremonyDone reveal the feed once the loading
    // narrative has played out. Without this, the brand tap just
    // snapped to the filtered feed with no transition.
    setSelectedProduct(null);
    setSelectedCreative(null);
    setSelectedLook(null);
    setBrandFilter(null);
    setSearchQuery(brandName);
    setCatalogName(toCatalogName(brandName));
    bumpSearchTrigger();
    lockGenderOverride();
    setHeroMode(true);
    setCeremony({ active: true, query: brandName, kind: 'brand' });
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
    // Desktop: pop a real new tab so the merchant lives in its own
    // window and the user can hop back to the catalog without the
    // in-app browser overlay covering the feed. Mobile / native shell
    // still use the in-app browser overlay so the trail of cards is
    // never lost. The shell guard mirrors the data-shell check the
    // rest of the app uses to gate native-only flows.
    const inNativeShell = typeof document !== 'undefined'
      && document.documentElement.dataset.shell === 'catalog-app';
    // For now, every product link opens the merchant in a real new tab on
    // web — desktop AND mobile — so the shopper keeps the catalog tab and
    // lands directly on the product. Only the native Flutter shell keeps
    // the in-app browser overlay (window.open doesn't pop a real tab
    // inside the embedded webview, and the shell owns that flow).
    if (!inNativeShell) {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      setBrowserState({ url, title, product });
    }
    // Every product clickout flows through this handler — feed tile,
    // look-overlay product chips, bookmarks page, ProductPage offers.
    // Centralising the trackProductClickout call here means a single
    // clickout firing once per actual click, regardless of which
    // surface initiated it. Earlier only the ProductPage offer
    // buttons reported clickouts so the admin Creators/Products
    // analytics undercounted by an order of magnitude.
    void trackProductClickout(url, product?.brand ?? null, product?.name ?? title);
  }, []);

  // Pull a "like-kinded" feed for the product page. Union of two signals:
  //   1. same brand
  //   2. shared catalog_tags (if any)
  // Both queries are capped and then merged + deduped client-side so the
  // feed still shows something when one bucket is empty.
  const fetchSimilarProducts = useCallback(async (brand: string | null, catalogTags: string[] | null, excludeId: string | null): Promise<Product[]> => {
    if (!supabase) return [];

    type Row = { id: string; name: string | null; brand: string | null; price: string | null; image_url: string | null; primary_image_url: string | null; url: string | null };
    const queries: Array<Promise<Row[]>> = [];

    if (brand) {
      queries.push((async () => {
        let q = supabase!
          .from('products')
          .select('id, name, brand, price, image_url, primary_image_url, url')
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
          .select('id, name, brand, price, image_url, primary_image_url, url')
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
          image: (row as { primary_image_url?: string | null }).primary_image_url || row.image_url || undefined,
        });
      }
    }
    return merged.slice(0, 24);
  }, []);

  const handleOpenProduct = useCallback(async (product: Product) => {
    pushRecent(product);
    // Pause every currently-playing <video> before the nav lands so
    // we don't briefly have two heroes + a rail of cards all decoding
    // at once. The TrailVideoHost pool resumes whichever video the
    // new page actually shows on mount.
    pauseAllVideos();
    setProductNavCount(c => c + 1);
    // Remember the look the user came from (if any) so the back button
    // on ProductPage returns to that look instead of the empty feed.
    setProductOpenedFromLook(selectedLook);
    setSelectedLook(null);
    // Unify the two product-page surfaces. Opening from a CreativeCard
    // used to set selectedCreative (so the page rendered with the video
    // hero), while opening from a Look's product list only set
    // selectedProduct (so the page rendered with the still poster).
    // Now that Product carries video_url + thumbnail_url (see
    // services/looks.ts), we synthesize a creative shell from those
    // fields whenever the product has a video, so the page is the same
    // regardless of where the click came from. When the product has no
    // primary video at all, selectedCreative stays null and the page
    // falls back to the still poster — same as before.
    const productVideoUrl = (product as Product & { video_url?: string }).video_url;
    const productThumb = (product as Product & { thumbnail_url?: string }).thumbnail_url;
    if (productVideoUrl) {
      setSelectedCreative({
        id: (product as Product & { creative_id?: string }).creative_id || '',
        product_id: (product as Product & { id?: string }).id || '',
        look_id: null,
        title: product.name,
        description: null,
        video_url: productVideoUrl,
        mobile_video_url: null,
        storage_path: null,
        thumbnail_url: productThumb || product.image || null,
        affiliate_url: null,
        prompt: null,
        prompt_extra: null,
        style: '',
        model: null,
        status: 'live',
        duration_seconds: null,
        aspect_ratio: null,
        resolution: null,
        cost_usd: null,
        impressions: 0,
        clicks: 0,
        error: null,
        enabled: true,
        created_at: '',
        completed_at: null,
        updated_at: null,
        product: {
          id: (product as Product & { id?: string }).id || '',
          name: product.name,
          brand: product.brand,
          price: product.price,
          image_url: product.image || null,
          images: null,
          url: product.url,
          type: null,
          catalog_tags: null,
          gender: null,
        },
      });
    } else {
      setSelectedCreative(null);
    }
    setSelectedProduct(product);
    setSelectedSimilar(null);
    setSimilarCreatives(null);
    setBrandCreatives(null);
    setGraphPairs(null);

    // Resolve the product's DB id once. Products opened from a Look, search,
    // or recents arrive WITHOUT an `id` but carry a `url`, so fall back to a
    // URL → id lookup. This single id drives the impression ping, the graph
    // "Pairs well with" rail, and the "Similar" rail below — all of which were
    // silently skipped before whenever the id was absent (i.e. every non-feed
    // entry point). Resolution is async so it never blocks navigation.
    const directId = (product as Product & { id?: string }).id || null;
    const context = [product.brand, product.name].filter(Boolean).join(' · ').slice(0, 200);
    const productIdP: Promise<string | null> = directId
      ? Promise.resolve(directId)
      : (product.url ? resolveProductIdByUrl(product.url).then(id => id || null) : Promise.resolve(null));

    void productIdP.then(productId => {
      // Impression ping (matches prior behaviour: fired whenever we had a
      // direct id or a url to resolve from).
      if (directId || product.url) void trackCreativeImpressions(productId, null, context);
      if (!productId) return;
      getGraphPairs([productId]).then(setGraphPairs).catch(() => {});
      // "Similar" rail: description-embedding similarity, seeded by product id
      // (migration 020). Type-gated server-side; empty → Popular fills.
      prefetchSimilarProducts(productId, 18)
        .then(rows => {
          primeTrailAssets(rows);
          setSimilarCreatives(rows);
        })
        .catch(() => { /* leave rail empty rather than throw */ });
    }).catch(() => {});

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

    // Fire impressions for the primary product + every other product in the
    // associated look (if any). Fire-and-forget — don't await so navigation
    // is never blocked by the look_products query.
    void trackCreativeImpressions(
      creative.product.id || null,
      creative.look_id || null,
      [creative.product.brand, creative.product.name].filter(Boolean).join(' · ').slice(0, 200),
    );

    const mapped: Product & { id?: string } = {
      id: creative.product.id || undefined,
      name: creative.product.name || 'Shop Now',
      brand: creative.product.brand || '',
      price: creative.product.price || '',
      url: creative.product.url || '',
      image: creative.product.primary_image_url || creative.product.image_url || undefined,
    };
    pushRecent(mapped);
    pauseAllVideos();
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
    // "Similar" rail: description-embedding similarity seeded by product id
    // (migration 020 / find_similar_products). Type-gated server-side so it
    // never mixes garment categories; empty → the Popular fallback fills.
    const similarP = prefetchSimilarProducts(creative.product.id || '', 18);
    const brandP = creative.product.brand
      ? prefetchCreativesByBrand(creative.product.brand, creative.product.id || null, 12)
      : Promise.resolve([] as ProductAd[]);
    const graphP = creative.product.id
      ? getGraphPairs([creative.product.id])
      : Promise.resolve([] as GraphPair[]);

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
    graphP.then(rows => { if (rows.length) setGraphPairs(rows); }).catch(() => {});
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

  // "Featured in Looks" — only show looks that actually contain the selected
  // product. Matched by product name (case-insensitive). If no look contains
  // the product, the section is hidden (empty array → conditional render in
  // ProductPage skips the block entirely).
  const lookCreativesForProduct = useMemo<Look[]>(() => {
    if (!selectedProduct) return [];
    const needle = selectedProduct.name.toLowerCase().trim();
    const brand = (selectedProduct.brand || '').toLowerCase().trim();
    return lookFeedTiles.filter(l =>
      (l.products || []).some(p => {
        if (p.name.toLowerCase().trim() !== needle) return false;
        if (brand && p.brand && p.brand.toLowerCase().trim() !== brand) return false;
        return true;
      })
    );
  }, [selectedProduct, lookFeedTiles]);

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
  // Cross-component "open MyCatalog" hook. CreatorPage's self-view
  // Edit button fires `catalog:open-my-catalog` instead of taking a
  // prop callback through every render path — same pattern as
  // catalog:open-account-menu and catalog:open-bookmarks.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOpen = () => openMyLooks();
    window.addEventListener('catalog:open-my-catalog', onOpen);
    return () => window.removeEventListener('catalog:open-my-catalog', onOpen);
  }, [openMyLooks]);
  // "My information" on your own creator catalog opens the profile /
  // info screen. Event-based for the same reason as open-my-catalog —
  // avoids threading a callback prop through CreatorPage's render paths.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOpen = () => { if (user) setShowProfile(true); };
    window.addEventListener('catalog:open-profile', onOpen);
    return () => window.removeEventListener('catalog:open-profile', onOpen);
  }, [user]);
  // Opening the wallet pushes a real history entry at /earnings so it's
  // deep-linkable AND browser-back returns to the catalog screen the
  // user was on (the navigation push, not an external referrer). Skip
  // the push if we're already at /earnings (e.g. fresh page load).
  const openWallet = useCallback(() => {
    setShowWallet(true);
    if (typeof window !== 'undefined' && window.location.pathname !== '/earnings') {
      window.history.pushState({}, '', '/earnings');
    }
  }, []);
  const openProfile = useCallback(() => setShowProfile(true), []);
  const closeBookmarks = useCallback(() => {
    history.replaceState({}, '', '/#app');
    setShowBookmarks(false);
  }, []);
  const closeMyLooks = useCallback(() => {
    history.replaceState({}, '', '/#app');
    setShowMyLooks(false);
  }, []);
  const closeWallet = useCallback(() => {
    // If we arrived at /earnings via in-app navigation (pushState), pop
    // the history entry so browser-back semantics stay consistent —
    // tapping back closes the wallet, doesn't bounce to a prior site.
    // If the user hit /earnings cold (no history to pop), replace into
    // /#app instead.
    if (typeof window !== 'undefined' && window.location.pathname === '/earnings') {
      if (window.history.length > 1) {
        window.history.back();
        // setShowWallet(false) will fire via the popstate listener below.
        return;
      }
      window.history.replaceState({}, '', '/#app');
    } else {
      history.replaceState({}, '', '/#app');
    }
    setShowWallet(false);
  }, []);

  // Open the wallet on cold load at /earnings, and sync open/close to
  // forward/back navigation so the URL is the source of truth.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => {
      const onEarnings = window.location.pathname === '/earnings';
      setShowWallet(onEarnings);
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  // Overlay-stack popstate listener. The user's complaint: "click the
  // fig tree, hit back, it should take me back to THIS look, not
  // somewhere else." useOverlayRouter pushes /p/<slug> when a product
  // opens — pressing browser back pops that history entry and fires
  // popstate here. We detect that selectedProduct is set but the URL
  // is no longer /p/, fire the same close handler the X button uses
  // (which restores productOpenedFromLook if it was set), and the
  // look re-renders underneath. Same logic for /l/: if the URL is
  // off /l/ but selectedLook is set, clear it.
  //
  // We use refs so the listener doesn't reattach on every state
  // change — it reads the current state through .current at fire
  // time. This makes the listener stable across re-renders.
  const productOpenedFromLookRef = useRef(productOpenedFromLook);
  productOpenedFromLookRef.current = productOpenedFromLook;
  const selectedProductRef = useRef(selectedProduct);
  selectedProductRef.current = selectedProduct;
  const selectedLookRef = useRef(selectedLook);
  selectedLookRef.current = selectedLook;
  const brandFilterRef = useRef(brandFilter);
  brandFilterRef.current = brandFilter;
  const creatorFilterRef = useRef(creatorFilter);
  creatorFilterRef.current = creatorFilter;
  const commentsTargetRef = useRef(commentsTarget);
  commentsTargetRef.current = commentsTarget;
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPop = () => {
      const path = window.location.pathname;
      const onProduct = path.startsWith('/p/');
      const onLook    = path.startsWith('/l/');
      const onBrand   = path.startsWith('/b/');
      const onCreator = path.startsWith('/c/');
      const onComments = path.startsWith('/comments/');
      // Comments overlay exit: URL left /comments/ but the overlay is still
      // open → user pressed back out of the thread. Clear it; the product /
      // look it sat on top of is still mounted underneath, untouched.
      if (!onComments && commentsTargetRef.current) {
        setCommentsTarget(null);
      }
      // Product overlay exit: URL is no longer /p/ but a product is
      // still open in state → user just pressed back out of the
      // product page. Mirror what the X close button does: clear the
      // product + its rails, and if it was opened from a look,
      // restore that look so the underlying surface reappears.
      if (!onProduct && selectedProductRef.current) {
        setSelectedProduct(null);
        setSelectedCreative(null);
        setSelectedSimilar(null);
        setSimilarCreatives(null);
        setBrandCreatives(null);
        setGraphPairs(null);
        const fromLook = productOpenedFromLookRef.current;
        if (fromLook && onLook) {
          setSelectedLook(fromLook);
          setProductOpenedFromLook(null);
        }
      }
      // Look overlay exit: URL is no longer /l/ but a look is still
      // open → user backed out of the look overlay too.
      if (!onLook && selectedLookRef.current) {
        setSelectedLook(null);
      }
      // Brand overlay exit.
      if (!onBrand && brandFilterRef.current) {
        setBrandFilter(null);
      }
      // Creator catalog exit — URL is no longer /c/ but a creator is
      // still open in state → user pressed back out of the creator
      // catalog. Without this clear, back would pop the URL but the
      // CreatorPage would stay mounted on top, and a second back
      // would leave the site entirely (the original complaint).
      if (!onCreator && creatorFilterRef.current) {
        setCreatorFilter(null);
      }
      // Back gesture that lands on the bare feed (no overlay left in the
      // URL) should return to the TOP — not wherever the feed was scrolled
      // when the overlay opened (which read as a mid-feed "stuck" position).
      if (!onProduct && !onLook && !onBrand && !onCreator && !onComments) {
        window.scrollTo({ top: 0, behavior: 'auto' });
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const closeProfile = useCallback(() => {
    history.replaceState({}, '', '/#app');
    setShowProfile(false);
  }, []);

  // Comments overlay. Open pushes the /comments/<type>/<slug> URL so it's
  // shareable + the back button pops it, but it does NOT navigate routes —
  // the product/look overlay underneath stays exactly as-is. Close goes
  // back if we pushed the entry (so the URL pops cleanly), else just clears.
  const openComments = useCallback((type: 'product' | 'look', slug: string) => {
    if (!slug) return;
    if (typeof window !== 'undefined') {
      window.history.pushState({ overlay: 'comments' }, '', `/comments/${type === 'product' ? 'p' : 'l'}/${slug}`);
    }
    setCommentsTarget({ type, slug });
  }, []);
  const closeComments = useCallback(() => {
    const onComments = typeof window !== 'undefined' && window.location.pathname.startsWith('/comments/');
    if (onComments && window.history.length > 1) {
      window.history.back();
    } else {
      // Cold load / no history to pop — just clear + normalize the URL.
      setCommentsTarget(null);
      if (onComments) window.history.replaceState({}, '', '/');
    }
  }, []);

  // Cold-load deep link: /comments/p|l/<slug> mounts _index (the route
  // re-exports it). Read the URL once and open the comment overlay.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const m = window.location.pathname.match(/^\/comments\/(p|l)\/(.+)$/);
    if (m) setCommentsTarget({ type: m[1] === 'p' ? 'product' : 'look', slug: decodeURIComponent(m[2]) });
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
    // The searchTrigger effect plays the ceremony when on the hero.
  }, []);
  const handleOpenLilyCreator = useCallback(() => setCreatorFilter('@lilywittman'), []);
  const handleProductClose = useCallback(() => {
    // Prefer history.back() when the product page was pushed via the
    // overlay router (i.e. the URL is currently /p/<slug>). That pops
    // the pushed entry, the browser navigates back to the previous URL
    // (the look's /l/<slug> or the feed at /), and the popstate
    // listener up the file mirrors the state cleanup + restoreFromLook.
    // Using history.back() instead of fresh state mutations means the
    // X close button and the browser back button take the SAME path,
    // so we never end up with a /l/ pushed on top of /p/ leaking
    // history entries that have to be tapped through. Falls back to a
    // direct state cleanup if there's no pushed entry to pop (e.g. the
    // user opened /p/<slug> as a cold-load — history.length is 1).
    if (typeof window !== 'undefined'
        && window.location.pathname.startsWith('/p/')
        && window.history.length > 1) {
      window.history.back();
      return;
    }
    // Cold-load / no pushed entry: just clear state directly.
    setSelectedProduct(null);
    setSelectedCreative(null);
    setSelectedSimilar(null);
    setSimilarCreatives(null);
    setBrandCreatives(null);
    setGraphPairs(null);
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
    creatorFilter,
    onOpenProduct: handleOpenProduct,
    onOpenCreative: handleOpenCreative,
    onOpenLook: handleOpenLook,
    onOpenBrand: handleOpenBrand,
    onOpenCreator: handleOpenCreator,
  });

  const handleBookmarksOpenLook = useCallback((look: Look) => {
    setShowBookmarks(false);
    handleOpenLook(look);
  }, [handleOpenLook]);

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

  // Lock the underlying feed while a product/look overlay is open so
  // swipe-down-to-dismiss only moves the overlay, not the page beneath.
  // iOS Safari needs position:fixed + saved scrollY (not just overflow:
  // hidden) for this to actually stop the body from scrolling. On close
  // we restore the prior scroll position so the shopper lands exactly
  // where they tapped — no jump to the top.
  useEffect(() => {
    if (!overlayOpen) return;
    if (typeof window === 'undefined') return;
    const scrollY = window.scrollY;
    const { body, documentElement: html } = document;
    const prev = {
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyWidth: body.style.width,
      bodyOverflow: body.style.overflow,
      htmlOverflow: html.style.overflow,
    };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    return () => {
      body.style.position = prev.bodyPosition;
      body.style.top = prev.bodyTop;
      body.style.width = prev.bodyWidth;
      body.style.overflow = prev.bodyOverflow;
      html.style.overflow = prev.htmlOverflow;
      window.scrollTo(0, scrollY);
    };
  }, [overlayOpen]);

  return (
    <TrailRoot>
    <TrailVideoHost>
    <div className={`app-root ${isLightMode ? 'light-mode' : ''}${overlayOpen ? ' has-overlay' : ''}${heroMode ? ' home-hero' : ''}${heroScrolled ? ' hero-scrolled' : ''}${heroBarFaded ? ' hero-bar-faded' : ''}${chromeHidden ? ' chrome-hidden' : ''}`}>
      {/* Singleton particle world — one canvas mounted at the app root,
          always visible. Splash, hero, search-ceremony, empty-catalog all
          render above this so the field stays continuous across every
          screen transition (no re-mount = no reseed = the same drift
          continues). Consumers retune speed via particleControls. */}
      <SiteParticleHost />
      {/* Branded splash while auth is resolving. Stays mounted for one
          extra fade-out tick after auth resolves, so the gate or app
          underneath cross-fades in instead of snapping. */}
      {authSplashMounted && (
        <div className={`auth-splash${authSplashLeaving ? ' leaving' : ''}`} aria-hidden="true">
          {/* Particle field painted INSIDE the splash, above its opaque
              base but below the wordmark. The site singleton sits behind
              the opaque splash bg (so it can't show through), so we mount
              a dedicated instance here with an explicit speed — one-off
              mounts ignore particleControls.paused and always render. */}
          <div className="auth-splash-particles">
            <ParticleBackground speed={1} />
          </div>
          <CatalogLogo className="auth-splash-logo" />
        </div>
      )}
      {(view === 'locked' || showSignIn) && !authLoading && !user && <PasswordGate />}
      {view === 'waitlisted' && user && (
        <WaitlistScreen user={user} onApproved={handleWaitlistApproved} />
      )}

      {/* The big SplashScreen and the cinematic SplashHost were both
          retired — on desktop they stacked behind the smaller
          auth-splash and read as two splashes. Only the auth-splash
          (CatalogLogo above) renders now while auth resolves; once
          auth settles, the app cross-fades in directly. See the
          cinematic auto-dismiss effect a few lines down — it fires
          'catalog:splash-done' for any listeners waiting on splash
          end so nothing hangs. */}

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
            <div className="header-center">
              <FollowingRail
                mode="both"
                onOpenCreator={handleOpenCreator}
                onCreateFollowingCatalog={handleCreateFollowingCatalog}
                onOpenFollowingList={openFollowingList}
              />
            </div>
            <PendingLookPill onOpen={() => navigate('/generate')} />
            <div className="header-right">
              {/* Earnings stays in its original slot. The activity pill
                  moved to the RIGHT of it per the latest spec — earnings
                  is the primary currency indicator, activity is the
                  secondary indicator so it sits after. Mobile-only;
                  desktop keeps the centered toast stack. Tap routes to
                  /activity (a dedicated screen, not the wallet). */}
              <HeaderWalletPill onOpenWallet={openWallet} />
              <HeaderActivityPill />
              {/* Desktop super-admin entry — its own button in the header so
                  the admin surface isn't buried in the profile menu. Mobile
                  uses the Account page's super-admin sub-section instead;
                  this button is hidden ≤768px via CSS. */}
              {user?.role === 'super_admin' && (
                <button
                  className="header-super-admin-btn"
                  onClick={() => navigate('/admin')}
                  aria-label="Super Admin"
                  title="Super Admin"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l9 4v6c0 5-3.7 9.4-9 10-5.3-.6-9-5-9-10V6l9-4z"/></svg>
                </button>
              )}
              <button className="bookmark-toggle" onClick={openBookmarks} aria-label="Bookmarks">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                {bookmarks.totalCount > 0 && <span className="bookmark-count">{bookmarks.totalCount}</span>}
              </button>
              <UserMenu
                onOpenBookmarks={openBookmarks}
                onOpenMyLooks={user?.role === 'creator' || user?.role === 'admin' || user?.role === 'super_admin' ? openMyLooks : undefined}
                onOpenWallet={user?.role === 'creator' ? openWallet : undefined}
                onOpenProfile={user ? openProfile : undefined}
                bookmarkCount={bookmarks.totalCount}
                user={user}
                onLogout={handleLogout}
                recentProducts={recentProducts}
                savedProducts={bookmarks.bookmarkedProducts}
                savedLooks={savedLooksForMenu}
                onOpenLook={handleOpenLook}
                onOpenProduct={handleOpenProduct}
                onOpenCreator={handleOpenCreator}
                activeFilter={activeFilter}
                onChangeCatalogGender={handleGenderFilterChange}
              />
            </div>
          </header>

          {/* Activity — unified notification pipeline. Drives both
              the realtime engagement toasts AND the catch-up
              summary toasts (mount-time + tab-return). */}
          <ActivityRealtimeToasts />

          {/* New home entry: the ask hero sits above the feed; scrolling
              down reveals the catalog. Hidden once a search resolves into
              results (heroMode flips off). */}
          {heroMode && !ceremony.active && (
            <ShoppingForHero onRevealFeed={handleRevealFeed} />
          )}

          <div className={`home-feed-wrap${revealResults ? ' home-results-reveal' : ''}`}>
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
            followedHandles={followingCatalog}
            mySizeOnly={mySizeOnly}
          />
          </div>

          <BottomBar
            activeFilter={activeFilter}
            onFilterChange={handleGenderFilterChange}
            searchQuery={searchQuery}
            onSearchChange={handleSearchChange}
            onSelectSuggestion={handleSelectSuggestion}
            onOpenCreators={handleOpenLilyCreator}
            catalogName={catalogName}
            searchLoading={searchLoading}
            mySizeOnly={mySizeOnly}
            onMySizeChange={setMySizeOnly}
          />

          {/* Magical loading screen between a hero search and its results. */}
          {ceremony.active && (
            <SearchCeremony query={ceremony.query} kind={ceremony.kind} ready={!searchLoading} onDone={handleCeremonyDone} />
          )}

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
                allLooks={liveLooks}
                popularFallback={popularFallback}
                onOpenCreative={handleOpenCreative}
                onOpenComments={openComments}
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
                renderSaved={
                  // Only the viewer's OWN catalog gets a Saved section —
                  // it's their personal saves, not the creator's.
                  user && creatorFilter === `user:${user.id}`
                    ? () => (
                        <Suspense fallback={null}>
                          <SavedScreen
                            embedded
                            bookmarks={bookmarks}
                            savedLooks={savedLooksForMenu}
                            onOpenLook={handleBookmarksOpenLook}
                            onOpenBrowser={handleOpenBrowser}
                            onOpenProduct={handleOpenProduct}
                            onOpenCreative={handleOpenCreative}
                            onOpenCreator={handleBookmarksOpenCreator}
                            onOpenBrand={handleOpenBrand}
                          />
                        </Suspense>
                      )
                    : undefined
                }
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

          {commentsTarget && (
            <Suspense fallback={null}>
              <CommentsPage
                targetType={commentsTarget.type}
                slug={commentsTarget.slug}
                onClose={closeComments}
                onOpenCreator={(h) => { closeComments(); handleOpenCreator(h); }}
              />
            </Suspense>
          )}

          {showBookmarks && (
            <Suspense fallback={null}>
              <BookmarksPage
                bookmarks={bookmarks}
                onClose={closeBookmarks}
                onOpenLook={handleBookmarksOpenLook}
                onOpenBrowser={handleOpenBrowser}
                onOpenProduct={handleOpenProduct}
                onOpenCreative={handleOpenCreative}
                onOpenCreator={handleBookmarksOpenCreator}
                onOpenBrand={handleOpenBrand}
                savedLooks={savedLooksForMenu}
              />
            </Suspense>
          )}

          {showMyLooks && (
            <Suspense fallback={null}>
              <MyLooks onClose={closeMyLooks} />
            </Suspense>
          )}

          {showFollowing && (
            <Suspense fallback={null}>
              <FollowingPage
                onOpenCreator={handleFollowingOpenCreator}
                onClose={closeFollowingList}
              />
            </Suspense>
          )}

          {showProfile && user && (
            <Suspense fallback={null}>
              <ProfilePage
                user={user}
                onClose={closeProfile}
                renderSaved={() => (
                  <Suspense fallback={null}>
                    <SavedScreen
                      embedded
                      bookmarks={bookmarks}
                      savedLooks={savedLooksForMenu}
                      onOpenLook={handleBookmarksOpenLook}
                      onOpenBrowser={handleOpenBrowser}
                      onOpenProduct={handleOpenProduct}
                      onOpenCreative={handleOpenCreative}
                      onOpenCreator={handleBookmarksOpenCreator}
                      onOpenBrand={handleOpenBrand}
                    />
                  </Suspense>
                )}
              />
            </Suspense>
          )}

          {showWallet && (
            <div className="my-looks-overlay my-looks-overlay--wallet">
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
                <Suspense fallback={<div style={{ padding: 32, textAlign: 'center', color: '#bbf7d0', fontSize: 14 }}>Loading wallet…</div>}>
                  <CreatorWallet />
                </Suspense>
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
                onCreateCatalog={handleCreateCatalog}
                onOpenComments={openComments}
                creative={
                  selectedCreative?.video_url
                    ? {
                        id: selectedCreative.id,
                        videoUrl: selectedCreative.video_url,
                        // Prefer the polished primary image so the hero
                        // poster matches the catalog tile exactly — same
                        // first frame the video animates from. Falls back
                        // to thumbnail/image when polish hasn't run.
                        thumbnailUrl:
                          selectedCreative.product?.primary_image_url
                          || selectedCreative.thumbnail_url
                          || selectedCreative.product?.image_url
                          || null,
                      }
                    : undefined
                }
                similarCreatives={similarCreatives ?? undefined}
                brandCreatives={brandCreatives ?? undefined}
                graphPairs={graphPairs ?? undefined}
                popularFallback={popularFallback}
                lookCreatives={lookCreativesForProduct}
                allLooks={liveLooks}
                fromLook={productOpenedFromLook}
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
