import { useState, useCallback, useEffect, useRef, useMemo, Suspense } from 'react';
import { useLocation, useNavigate, Outlet } from '@remix-run/react';
import { lazyWithReload } from '~/utils/lazyWithReload';
import PasswordGate from '~/components/PasswordGate';
import WaitlistScreen from '~/components/WaitlistScreen';
import ShoppingForHero from '~/components/home/ShoppingForHero';
import SearchCeremony from '~/components/home/SearchCeremony';
import SearchCatalogStrip from '~/components/home/SearchCatalogStrip';
import SplashHost from '~/components/splash/SplashHost';
import { getSplashConfig, DEFAULT_SPLASH_CONFIG, type SplashConfig } from '~/services/splash-config';
import ContinuousFeed from '~/components/ContinuousFeed';
import SiteParticleHost from '~/components/SiteParticleHost';
import ParticleBackground from '~/components/ParticleBackground';
import BottomBar from '~/components/BottomBar';
import GuestSignupGate, { type GuestGateVariant } from '~/components/GuestSignupGate';
import { isGuest, hasUsedFreeLook, markFreeLookUsed, setGuestIntent, takeGuestIntent, getNudgeCount, bumpNudgeCount, REQUIRE_SIGNUP_EVENT } from '~/services/guest';
import { TrailVideoHost } from '~/components/TrailVideoHost';
import { TrailRoot } from '~/components/TrailMotion';
import CatalogLogo from '~/components/CatalogLogo';
import UserMenu from '~/components/UserMenu';
import { Look, Product } from '~/data/looks';
import { useBookmarks } from '~/hooks/useBookmarks';
import { useRecentProducts } from '~/hooks/useRecentProducts';
import { useAuth } from '~/hooks/useAuth';
import { useOverlayRouter } from '~/hooks/useOverlayRouter';
import { lookSlug, productSlug } from '~/utils/slug';
import { markOverlayReturn } from '~/utils/overlay-scroll-stash';
import { affiliateRedirect, setAffiliateContext } from '~/services/affiliate';
import { useShellBridge } from '~/hooks/useShellBridge';
import { useAppView } from '~/hooks/useAppView';
import { useWaitlistMode, applyFlowOverrideFromUrl } from '~/hooks/useWaitlistMode';
import { useSearchUrlSync } from '~/hooks/useSearchUrlSync';
import { useShopperGender } from '~/hooks/useShopperGender';
import { toCatalogName, getRandomCatalogName } from '~/utils/catalogName';
import { funnyCatalogName, isConversationalQuery } from '~/utils/searchIntent';
import { prefetchSimilarProducts, prefetchCreativesByBrand, prefetchHomeFeed, pruneStaleHomeFeedCaches, type ProductAd } from '~/services/product-creative';
import { pruneStalePersistedOrders } from '~/services/personalized-feed';
import { getGraphPairs, type GraphPair } from '~/services/graph-pairs';
import { getLooks, getLookByUuid } from '~/services/looks';
import { suggestCatalogs } from '~/services/catalog-suggest';
import { getPopularCatalogPills } from '~/services/catalogs';
import { getMyFollowing } from '~/services/follows';
import { creativeStill, creativePoster, productPoster } from '~/services/media-resolver';
import { pickVideoUrl, pickPlaybackSource } from '~/services/video-loading';
import { emitSavedToast } from '~/utils/savedToast';
import { prefetchDials } from '~/services/dials';
import { hydrateVideoPipeline, videoPipelineMode } from '~/services/video-pipeline';
import { prefetchHiddenContent } from '~/hooks/useHiddenLooks';
import { prefetchBrandLogos } from '~/hooks/useBrandLogoLookup';
import { primeTrailAssets } from '~/utils/trailPrefetch';
import { supabase } from '~/utils/supabase';
import { trackClick, trackCreativeImpressions, resolveProductIdByUrl, trackProductClickout } from '~/services/session-tracker';
import { retireServiceWorker } from '~/utils/registerSW';
import HeaderWalletPill from '~/components/HeaderWalletPill';
import HeaderActivityPill from '~/components/HeaderActivityPill';
import FollowingRail from '~/components/FollowingRail';
import CreatorConstellation from '~/components/CreatorConstellation';
import { snapPeople } from '~/utils/peoplePanel';
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
const importCommentsPage = () => import('~/components/CommentsPage');

const CreatorPage = lazyWithReload(importCreatorPage);
const BrandPage = lazyWithReload(importBrandPage);
const BookmarksPage = lazyWithReload(importBookmarksPage);
const ProductPage = lazyWithReload(importProductPage);
const LookOverlay = lazyWithReload(importLookOverlay);
const InAppBrowser = lazyWithReload(importInAppBrowser);
const MyLooks = lazyWithReload(importMyLooks);
const CreatorWallet = lazyWithReload(importCreatorWallet);
const ProfilePage = lazyWithReload(importProfilePage);
const FollowingPage = lazyWithReload(importFollowingPage);
// Shared Saved screen, embedded into My Account + My Catalog. Lazy so it
// only loads when a saved surface actually mounts.
const SavedScreen = lazyWithReload(() => import('~/components/SavedScreen'));
// Comment thread, rendered as an in-app overlay (not a route) so backing
// out of it never tears down / re-resolves the product or look underneath.
// Its chunk is idle-prefetched (see IDLE_PREFETCH_ORDER) so tapping the
// comments button never hits a cold/stale lazy-load — that failure path
// triggered a full-page reload (auth-splash → home → comment deep-link),
// which is the "splash then home then comments" jump we're killing here.
const CommentsPage = lazyWithReload(importCommentsPage);

// Phase 1 gate cutover. When VITE_CLERK_PUBLISHABLE_KEY is set, the Clerk
// session gate (ClerkSignInGate) replaces the access-code PasswordGate. Both the
// constant and the lazy import are dead/untriggered when the key is unset, so
// prod and the Flutter shell keep the exact current PasswordGate + Supabase path
// and the Clerk SDK stays out of the feed bundle.
const CLERK_AUTH_ENABLED = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const ClerkSignInGate = lazyWithReload(() => import('~/components/ClerkSignInGate'));

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
  // Comments open straight from product/look surfaces, so warm it early —
  // a stale lazy-load here forces a full reload (splash → home → comments).
  importCommentsPage,
  importInAppBrowser,
  importBookmarksPage,
  importCreatorPage,
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

// Disable the browser's scroll restoration on the home screen. Default
// 'auto' restores the previous scroll position on F5 / pull-to-refresh
// — which lands the user mid-hero on the home screen. The search bar
// is pinned at bottom: 38vh from the viewport, but every fixed/sticky
// header element above it is measured from "top of document", so a
// mid-page reload offsets the bar off-center until the user scrolls
// back to 0. Owning the restore manually keeps refresh at the top.
if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
  try { window.history.scrollRestoration = 'manual'; } catch { /* Safari edge */ }
}

// ── In-memory detail navigation ─────────────────────────────────────────
// How a detail surface (product/look) records itself onto the nav stack.
//   'push' — a fresh in-app open: append a frame AND push a history entry.
//   'seed' — a cold/deep-link or forward-nav re-resolve: append a frame, but
//            the history entry already exists (the browser put us there) so
//            don't push another one.
//   'none' — a back/restore from memory: the frame is already in the stack
//            and the browser already popped to its entry; just re-render +
//            reload the (below-the-fold) rails, no frame push, no history op.
export type NavMode = 'push' | 'seed' | 'none';

// One entry in the detail trail. Holds the FULL entity (and, for a product,
// its creative) so Back restores the surface straight from memory — no slug
// re-resolve, no network refetch, no clear-to-feed flash.
export type NavFrame =
  | { key: number; kind: 'product'; slug: string; product: Product; creative: ProductAd | null }
  | { key: number; kind: 'look'; slug: string; look: Look };

// How many trail frames stay MOUNTED at once. The full trail lives in navStack
// (as data) so the back history is never lossy, but only the last N frames
// render as overlays: 1 visible top + (N-1) warm-hidden behind it. Frames
// deeper than this are data-only and re-mount — hidden, behind the current top,
// from memory (no network, scroll restored via the overlay-scroll-stash) — the
// moment a Back brings them back into the window. This bounds mounted DOM +
// <video> elements no matter how deep the shopper drills, while keeping Back
// instant (the destination is always a pre-warmed layer). 3 = top + 2 warm,
// which covers a rapid double-Back without the second one hitting a cold mount.
const NAV_MOUNT_WINDOW = 3;

const navSlugForProduct = (p: Product): string =>
  productSlug({
    id: (p as Product & { id?: string | null }).id ?? null,
    brand: p.brand ?? null,
    name: p.name ?? null,
  });

const navSlugForLook = (l: Look): string =>
  lookSlug({
    id: l.id ?? null,
    uuid: l.uuid ?? null,
    creator: l.creator ?? null,
    creatorDisplayName: l.creatorDisplayName ?? null,
    title: l.title ?? null,
  });

// Map a frame's stored creative to ProductPage's `creative` prop. Mirrors the
// pickPlaybackSource chain CreativeCardV2 donated on tap so the detail hero
// reuses the exact same source/poster (no reload). Returns undefined when the
// product has no playable video → ProductPage falls back to the still poster.
function mapCreativeForPage(creative: ProductAd | null) {
  if (!creative || !pickPlaybackSource(creative)) return undefined;
  return {
    id: creative.id,
    videoUrl: pickVideoUrl(creative) || creative.video_url || '',
    hlsUrl:
      videoPipelineMode() === 'hls'
        ? (creative.product?.primary_hls_url || creative.hls_url || null)
        : null,
    thumbnailUrl:
      creative.product?.primary_image_url
      || creative.thumbnail_url
      || creative.product?.image_url
      || null,
  };
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
  // Launch master switch (dials page). true = old waitlist/sign-in-only
  // flow; false = open flow with the guest gates. Consume any ?flow=
  // preview override once before the first read.
  useState(() => { applyFlowOverrideFromUrl(); return null; });
  const { waitlistMode, loading: waitlistLoading } = useWaitlistMode();

  // Top-level view state machine (locked / app / waitlisted) + the two
  // splash overlays (first-visit branded splash and the auth-resolving
  // fade). See useAppView.
  const {
    view,
    setView,
    firstVisit,
    authSplashMounted,
    authSplashLeaving,
  } = useAppView({ user, authLoading, waitlistMode, waitlistLoading });

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
    // cinematic on the next tick. (We DON'T fire catalog:splash-done here
    // anymore — that's owned by the auth-splash lifecycle effect below, so
    // notifications wait for the splash the user actually sees to finish.)
    const t = setTimeout(() => {
      setCinematic(c => ({ ...c, active: false }));
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Notifications (ActivityRealtimeToasts) wait on catalog:splash-done. The
  // ONLY splash the shopper actually sees is the auth-splash (the "Catalog"
  // wordmark), so fire the event off ITS lifecycle: once it's no longer
  // mounted — whether it finished fading out or never armed this load — the
  // gate may open. Firing more than once is harmless (the listener just flips
  // a boolean).
  useEffect(() => {
    if (authSplashMounted) return;
    try { window.dispatchEvent(new Event('catalog:splash-done')); } catch { /* ignore */ }
  }, [authSplashMounted]);

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
  // Sign-in gate overlay. Shown when a guest hits a sign-in-only surface.
  // Cleared the moment a session resolves (the auto-route effect then
  // takes them in).
  const [showSignIn, setShowSignIn] = useState(false);
  useEffect(() => { if (user) setShowSignIn(false); }, [user]);
  // The pull-down "people & brands" page (CreatorConstellation). Opened by the
  // home top-edge pull gesture (PullDownActivityGesture → 'catalog:open-people').
  const [peopleOpen, setPeopleOpen] = useState(false);
  // Guest freemium gate. The signup scrim that dissolves over a look teaser
  // ('look'), a creator catalog ('creator'), or the feed scroll nudge
  // ('feed'). null = no gate showing. Cleared the moment a session resolves.
  const [guestGate, setGuestGate] = useState<{ variant: GuestGateVariant } | null>(null);
  const lookTeaseTimer = useRef<number | null>(null);
  const creatorTeaseTimer = useRef<number | null>(null);
  useEffect(() => { if (user) setGuestGate(null); }, [user]);
  useEffect(() => () => {
    if (lookTeaseTimer.current) window.clearTimeout(lookTeaseTimer.current);
    if (creatorTeaseTimer.current) window.clearTimeout(creatorTeaseTimer.current);
  }, []);
  // Feature chokepoints (follow, …) raise the gate via this event when a
  // guest attempts a signed-in action.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onRequire = () => setGuestGate(g => g ?? { variant: 'feed' });
    window.addEventListener(REQUIRE_SIGNUP_EVENT, onRequire);
    return () => window.removeEventListener(REQUIRE_SIGNUP_EVENT, onRequire);
  }, []);
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
  // In-memory detail trail (product/look). The source of truth for Back AND
  // for what renders: each frame is a LAYER — they're all kept mounted, the
  // top one visible/active, the ones beneath warm behind it (see the layered
  // map in the JSX). Back pops a frame and the layer beneath — already mounted
  // — is revealed instantly with no remount, no clear-to-feed gap, no refetch.
  // selectedProduct/selectedLook below mirror the top frame for the many
  // readers (has-overlay, guest gate, …). navStackRef mirrors the state so the
  // empty-dep popstate listener reads the latest at fire time.
  const [navStack, setNavStack] = useState<NavFrame[]>([]);
  const navStackRef = useRef<NavFrame[]>(navStack);
  const navSeqRef = useRef(0);
  // Single writer for the trail: keeps the render-state and the ref in lockstep.
  const setNav = useCallback((updater: (prev: NavFrame[]) => NavFrame[]) => {
    setNavStack(prev => {
      const next = updater(prev);
      navStackRef.current = next;
      return next;
    });
  }, []);
  // No-op close for layers that aren't on top: only the top layer's overlay
  // should react to Escape / a close gesture, so lower (covered) layers get
  // this instead of the real close handler.
  const noop = useCallback(() => {}, []);
  // Async slug→entity resolvers, surfaced from useOverlayRouter. Used ONLY as
  // the cold/forward-nav fallback when a popped /p/ or /l/ slug isn't in the
  // in-memory stack. Stashed in refs so the empty-dep popstate listener reads
  // the latest without re-subscribing.
  const openProductFromSlugRef = useRef<((slug: string) => void) | null>(null);
  const openLookFromSlugRef = useRef<((slug: string) => void) | null>(null);
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
  const { searchQuery, setSearchQuery, searchTrigger, bumpSearchTrigger, triggerSource } = useSearchUrlSync();
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
  // results. Shown everywhere — including inside the native Flutter shell,
  // which now mirrors the mobile-web home: the hero's centred search bar is
  // the repositioned #bottom-bar, and the shell hides only its resting/docked
  // state (see bottom-bar.css) so there's no extra pill at the bottom.
  const inShell = typeof document !== 'undefined' && document.documentElement.dataset.shell === 'catalog-app';
  const [heroMode, setHeroMode] = useState(true);
  const [heroScrolled, setHeroScrolled] = useState(false);
  // The followed-creators rail is pinned (position:fixed) at the top of the
  // hero while the page is at rest, but it lives in the high-z-index header so
  // it floats ABOVE the in-flow hero (the spark, the "Your daily feed" cue +
  // its "?" button) and the feed peek. The instant the shopper scrolls, that
  // hero content slides UP under the still-clickable rail — so a tap aimed at
  // the "?" (or a peeking card) landed on whichever rail avatar shared that
  // column and wrongly opened that creator's catalog. Deactivating the rail on
  // the FIRST bit of scroll (not at the quarter-viewport hero-scrolled
  // threshold) closes that window: it fades + goes pointer-events:none together.
  const [heroRailInert, setHeroRailInert] = useState(false);
  const [ceremony, setCeremony] = useState<{ active: boolean; query: string; kind: 'search' | 'brand' }>({ active: false, query: '', kind: 'search' });
  // Result product images surfaced by ContinuousFeed once a search resolves —
  // floated in the particle field behind the search ceremony.
  const [ceremonyImages, setCeremonyImages] = useState<string[]>([]);
  const [revealResults, setRevealResults] = useState(false);
  // Demographic-aware catalog names shown at the END of the search ceremony.
  // suppressCeremonyRef lets a recommended-catalog pick re-run the search
  // WITHOUT replaying the ceremony; the seq ref drops stale async results.
  const [ceremonyRecs, setCeremonyRecs] = useState<string[]>([]);
  // True once the catalog-suggest call has RESOLVED (with picks or empty). Lets
  // the ceremony tell "still fetching suggestions" from "fetched, none" — so a
  // conversational query holds for the picks instead of racing ahead to results.
  const [ceremonyRecsReady, setCeremonyRecsReady] = useState(false);
  const suppressCeremonyRef = useRef(false);
  const ceremonyRecSeqRef = useRef(0);
  // Chrome auto-hide on scroll-down once you're past the hero. Header
  // slides up offscreen, bottom search bar slides down — full-screen feed.
  // Scrolling up brings them back; stopping preserves the current state.
  const [chromeHidden, setChromeHidden] = useState(false);

  // ── Home-feed grid-density dial (mobile) ──────────────────────────────
  // A minimal wheel pinned to the right edge that cycles the MOBILE home feed
  // grid between 1, 2 (default), and 3 columns. Tap cycles; scroll/drag steps.
  // Persisted under its OWN key (NOT the creator key) so the two surfaces keep
  // independent densities. The value drives --feed-cols on .home-feed-wrap,
  // which the mobile .feed-section-grid reads (feed.css). Mirrors the creator
  // catalog dial (CreatorPage.tsx) but the auto-hide is INVERTED: hidden at the
  // top of the feed, fades in once the shopper starts scrolling.
  const FEED_GRID_COLS = [1, 2, 3] as const;
  const [feedColsIndex, setFeedColsIndex] = useState<number>(() => {
    try {
      const v = Number(window.localStorage.getItem('catalog:feed-grid-cols'));
      const i = FEED_GRID_COLS.indexOf(v as 1 | 2 | 3);
      return i >= 0 ? i : 1; // default = 2 columns
    } catch { return 1; }
  });
  const feedGridCols = FEED_GRID_COLS[feedColsIndex];
  useEffect(() => {
    try { window.localStorage.setItem('catalog:feed-grid-cols', String(feedGridCols)); } catch { /* quota */ }
    // FeedSection's mobile DOM-windowing measures (cols, rowH) from the DOM and
    // re-measures on a `resize` event; it derives padTop from windowStart/cols.
    // Changing the column count without forcing a re-measure leaves padTop stale
    // → the feed blanks out or jumps (the bug: the dial moved but the grid never
    // relaid out for the new cols). Dispatch a resize so every mounted
    // FeedSection re-measures against the new column count. DOUBLE rAF: the first
    // frame lets React commit the new --feed-cols inline style, the second lets
    // the browser COMMIT the grid relayout, so measure() reads the new cols/rowH
    // (not the pre-change layout) — otherwise it captures stale metrics.
    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
      });
    }
  }, [feedGridCols]);
  const feedDialRef = useRef<HTMLDivElement | null>(null);
  const feedDialDraggedRef = useRef(false);
  // Appear-on-scroll: hidden at the top of the feed, fades in once scrolling
  // begins. Inverts the creator dial (which shows at top, hides on scroll).
  const [feedDialVisible, setFeedDialVisible] = useState(false);
  // Opening a look/product overlay locks the body with position:fixed, which
  // snaps document scroll to 0 (and fires a synthetic scroll); closing
  // restores the scroll (another synthetic scroll). Both scroll-trackers
  // below would read those programmatic jumps as a real "scrolled to top →
  // scrolled back down" and animate the search bar up to the hero
  // (mid-screen) position and back — that round-trip IS the lag the shopper
  // sees on open/close. This ref freezes both trackers for the whole time an
  // overlay is open and through the close-restore (cleared a frame later), so
  // the bar's position never moves across the round-trip.
  const overlayScrollLockRef = useRef(false);


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

  // Backfill missing look posters in the background. Looks without a poster
  // render as blank grey cards (Saved screen, etc.); generating one from the
  // video frame fixes them everywhere. Gated to admins, who have write
  // access, and fired once per session, idle, so it never blocks the feed.
  useEffect(() => {
    if (user?.role !== 'admin' && user?.role !== 'super_admin') return;
    const run = () => import('~/services/poster-backfill')
      .then(({ backfillMissingLookPosters }) => backfillMissingLookPosters())
      .catch(() => {});
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const id = ric ? ric(run) : window.setTimeout(run, 4000);
    return () => {
      const cic = (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
      if (ric && cic) cic(id); else window.clearTimeout(id);
    };
  }, [user?.role]);

  // Pause the site singleton particle field whenever the feed is the focus
  // (hero dismissed or scrolled past) — it's fully covered there, so drawing
  // it is wasted GPU that competes with video decode on scroll.
  useEffect(() => {
    import('~/services/particles').then(({ particleControls }) => {
      particleControls.paused = !heroMode || heroScrolled;
    });
  }, [heroMode, heroScrolled]);

  // Tell the two TypeAnywhere copies who's in charge: while the hero is at the
  // top, the inline copy (inside ShoppingForHero) owns the screen and the
  // global fixed copy steps aside; once the shopper scrolls into the feed (or
  // the ceremony takes over) they swap back. See TypeAnywhere `inline`.
  useEffect(() => {
    const active = heroMode && !ceremony.active && !heroScrolled;
    window.dispatchEvent(new CustomEvent('catalog:hero-inline', { detail: { active } }));
  }, [heroMode, ceremony.active, heroScrolled]);

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
      setHeroRailInert(false);
      if (typeof document !== 'undefined') {
        document.documentElement.style.setProperty('--hero-scroll-progress', '1');
      }
      return;
    }
    setHeroScrolled(false);
    setHeroBarFaded(false);
    setHeroRailInert(false);
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--hero-scroll-progress', '0');
    }
    let raf = 0;
    const onScroll = () => {
      // Ignore the body-lock's programmatic scroll jumps while a look/product
      // overlay is open — they aren't real scrolls and must not reposition the
      // hero bar (the open→middle→down animation that read as lag).
      if (overlayScrollLockRef.current) return;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const ratio = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.5)));
        document.documentElement.style.setProperty('--hero-scroll-progress', String(ratio));
        // Same 0.5 cutoff as the CSS opacity formula (1.2 - r*2.4 ≤ 0)
        // so pointer-events flip off the moment the bar is visually
        // invisible. Without this hook the faded bar still ate taps
        // meant for the product tiles below it.
        setHeroBarFaded(ratio >= 0.5);
        // Kill the followed-creators rail's taps the moment we leave the
        // pristine top (it's a fixed, header-z-index row that floats over the
        // scrolling hero "?" + feed peek). A few px of deliberate scroll is the
        // signal; below that we keep it live so a resting tap on an avatar
        // still opens that creator.
        setHeroRailInert(window.scrollY > 8);
        // Dock early: by a quarter-screen of scroll the feed peek owns
        // the viewport — the bar belongs at the bottom, not floating
        // mid-screen over product cards (the founder's screenshot).
        setHeroScrolled(window.scrollY > window.innerHeight * 0.25);
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
  // flicker the chrome. The search bar's hidden/shown state is preserved
  // across an overlay open→close (the body-lock's synthetic scrolls are
  // ignored via overlayScrollLockRef), so the bar only returns on a genuine
  // scroll-up or at the hero top — never just because a look/product closed.
  useEffect(() => {
    if (!heroScrolled) { setChromeHidden(false); return; }
    let lastY = window.scrollY;
    const THRESHOLD = 8; // px of continuous direction before reacting
    let accum = 0;
    let idle = 0;
    let raf = 0;
    // The direction math + setChromeHidden run at most ONCE per frame. iOS fires
    // scroll at up to ~60Hz during momentum; calling setState off every raw
    // event re-rendered the whole feed per event and contended with the video
    // director's per-frame rank() — a primary cause of the on-device scroll
    // jank. Sampling scrollY once per rAF gives the same telescoped accumulation
    // (deltas still sum across the gesture) at a fraction of the work.
    const apply = () => {
      raf = 0;
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
    const onScroll = () => {
      // Frozen while an overlay is open — see overlayScrollLockRef. Leaving
      // lastY untouched keeps the delta continuous when scrolling resumes.
      if (overlayScrollLockRef.current) return;
      // Rest return: 2s after the last real scroll the chrome eases back
      // (same rhythm as the card chrome) — "the search bar is missing"
      // should never outlive the scroll that hid it.
      window.clearTimeout(idle);
      idle = window.setTimeout(() => setChromeHidden(false), 2000);
      if (raf) return;
      raf = requestAnimationFrame(apply);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.clearTimeout(idle);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [heroScrolled]);

  // Grid-density dial appear-on-scroll. The home feed document-scrolls, so we
  // read window.scrollY: hidden at the very top, faded in once the shopper has
  // scrolled past a small threshold (a deliberate inversion of the creator
  // dial). Frozen while an overlay is open (overlayScrollLockRef) so the
  // body-lock's synthetic scroll jumps don't flip it. Sampled once per rAF.
  useEffect(() => {
    let raf = 0;
    const SHOW_AT = 120; // px of scroll before the dial fades in
    const onScroll = () => {
      if (overlayScrollLockRef.current) return;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setFeedDialVisible(window.scrollY > SHOW_AT);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Tap a dial segment → DIRECTLY select that column count (1 / 2 / 3) — the
  // founder wants the segments to be a direct picker, not a 1→2→3 cycle.
  // Suppressed right after a drag so the touchend-synthesized click doesn't
  // fight a vertical-drag step. The wheel/drag handlers below still STEP.
  // Tap ANYWHERE on the dial cycles to the next density (1 → 2 → 3 → 1). The
  // shopper doesn't have to hit an exact segment. The dragged guard keeps a
  // scroll/drag gesture from also firing a cycle on release.
  const cycleFeedCols = useCallback(() => {
    if (feedDialDraggedRef.current) { feedDialDraggedRef.current = false; return; }
    setFeedColsIndex(i => (i + 1) % FEED_GRID_COLS.length);
  }, []);
  // Wheel + vertical-drag stepping on the dial. Attached non-passive so the
  // gesture on the dial doesn't scroll the feed behind it.
  useEffect(() => {
    const el = feedDialRef.current;
    if (!el) return;
    const clamp = (i: number) => Math.min(FEED_GRID_COLS.length - 1, Math.max(0, i));
    let accum = 0;
    let touchY: number | null = null;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      accum += e.deltaY;
      if (Math.abs(accum) > 22) { setFeedColsIndex(i => clamp(i + (accum > 0 ? 1 : -1))); accum = 0; }
    };
    const onTouchStart = (e: TouchEvent) => { touchY = e.touches[0].clientY; feedDialDraggedRef.current = false; };
    const onTouchMove = (e: TouchEvent) => {
      if (touchY == null) return;
      e.preventDefault();
      const dy = e.touches[0].clientY - touchY;
      if (Math.abs(dy) > 24) {
        setFeedColsIndex(i => clamp(i + (dy > 0 ? 1 : -1)));
        touchY = e.touches[0].clientY;
        feedDialDraggedRef.current = true;
      }
    };
    const onTouchEnd = () => { touchY = null; };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  // Any committed search while on the hero (bottom bar Enter, a catalog
  // pill, the type-anywhere overlay, or a deep-linked ?q=) bumps
  // searchTrigger — that's our single universal cue to play the ceremony,
  // then reveal results. Live typing doesn't bump the trigger, so the
  // hero stays put while the shopper types.
  const prevTriggerRef = useRef(searchTrigger);
  useEffect(() => {
    if (searchTrigger === prevTriggerRef.current) return;
    prevTriggerRef.current = searchTrigger;
    // Back/forward restore (popstate) re-runs the search to repaint results,
    // but must NOT replay the ceremony — coming back from a product should
    // land on the results catalog, not the loading animation again.
    if (triggerSource.current === 'pop') return;
    // A recommended-catalog pick re-runs the search; it sets this so the bump
    // doesn't replay the ceremony (it goes straight to results).
    if (suppressCeremonyRef.current) { suppressCeremonyRef.current = false; return; }
    // Play the ceremony on EVERY committed search (Enter / suggestion tap /
    // brand) — whether from the hero or the bottom search bar in the feed.
    // Live typing doesn't bump the trigger, so it never fires mid-type.
    if (searchQuery.trim() && !ceremony.active) {
      const q = searchQuery.trim();
      // Crown the result with a fun, on-topic catalog name ("I need a dress for
      // italy" → "Italy-Coded Dresses") instead of the literal sentence.
      setCatalogName(funnyCatalogName(q));
      setCeremonyImages([]);
      setCeremony({ active: true, query: q, kind: 'search' });
      // Kick off demographic-aware catalog suggestions for the END of the
      // ceremony (resolves to [] on failure → ceremony just reveals results).
      // Seq-guarded so a slow call from a previous search can't bleed in.
      setCeremonyRecs([]);
      setCeremonyRecsReady(false);
      const seq = ++ceremonyRecSeqRef.current;
      void suggestCatalogs(q, { gender: activeFilter }).then(recs => {
        if (ceremonyRecSeqRef.current !== seq) return;
        setCeremonyRecs(recs);
        setCeremonyRecsReady(true);
      });
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

  // Shopper tapped a recommended catalog at the end of the ceremony — run THAT
  // catalog straight away, with no second ceremony (suppressCeremonyRef gates
  // the searchTrigger bump below).
  const handlePickRecommendedCatalog = useCallback((name: string) => {
    const q = name.trim();
    if (!q) return;
    suppressCeremonyRef.current = true;
    setCeremony({ active: false, query: '', kind: 'search' });
    setCeremonyRecs([]);
    setHeroMode(false);
    setSearchQuery(q);
    bumpSearchTrigger();
    setRevealResults(true);
    window.setTimeout(() => setRevealResults(false), 950);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'auto' });
  }, [inShell, setSearchQuery, bumpSearchTrigger]);

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
    setHeroMode(true);
    window.scrollTo({ top: 0, behavior: 'auto' });
    setSearchQuery('');
    resetGenderFilter();
    setCreatorFilter(null);
    setBrandFilter(null);
    setNav(() => []); // logo = home: abandon the detail trail
    setSelectedProduct(null);
    setSelectedCreative(null);
    setSelectedLook(null);
    setShowBookmarks(false);
    setShowMyLooks(false);
    setShuffleKey(k => k + 1);
    setCatalogName('all');
    // Fully tear down the searched-feed state. Clearing searchQuery alone left
    // the SearchCatalogStrip data (ceremonyRecs) + the ceremony/reveal flags
    // live, so a searched/browsing feed (the `.has-catalog-strip` state, e.g.
    // "Pizza") didn't fully return to the home hero on a logo tap. Reset them
    // all so the logo reliably lands on the hero from ANY searched state.
    setCeremonyRecs([]);
    setCeremonyImages([]);
    setCeremony({ active: false, query: '', kind: 'search' });
    setRevealResults(false);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('catalog:close-search'));
      // Push the URL bar back to "/" so clicking the logo from a
      // deep-linked surface (/l/<look-slug>, /p/<product-slug>,
      // /b/<brand-slug>, or /?q=<search>) cleanly resets to the
      // catalog root. ALWAYS navigate — don't gate on
      // window.location.search. A search applied via the ?q= deep-link /
      // TypeAnywhere path strips ?q= from the URL bar with replaceState,
      // which does NOT notify React Router, so useLocation() stays stale
      // at "?q=…" while window.location.search reads "". The old guard
      // (`|| window.location.search`) then saw an empty search and SKIPPED
      // navigate, leaving useLocation() stranded on the searched route —
      // so the logo never returned home from that path. navigate('/')
      // no-ops cleanly when already home and resyncs useLocation() when
      // it was stale; that resync is also what lets a re-submitted search
      // re-fire the ?q= effect afterwards.
      //
      // BUT: My Catalog / Bookmarks open via a RAW window.history.pushState
      // ('/my-looks', '/bookmarks') that React Router never observes, so RR's
      // internal location stays '/' while the URL bar shows '/my-looks'. A
      // plain navigate('/') is then a PUSH that RR computes from its stale
      // internal '/', so it stacks a fresh '/' entry ON TOP of the dangling
      // '/my-looks' bar entry — Back returns to '/my-looks' and a refresh
      // there reopens My Catalog via the cold-open `startsWith('/my-looks')`
      // effect, so the logo "still lands on My Looks". Authoritatively pin the
      // URL bar to '/' first (raw replaceState — same belt-and-braces the
      // overlay-search path and the address-bar safety net use), THEN
      // navigate('/', { replace: true }) so RR replaces (not pushes) and
      // resyncs onto the clean root with no stranded deep-link entry behind it.
      if (window.location.pathname !== '/' || window.location.search) {
        window.history.replaceState({}, '', '/');
      }
      navigate('/', { replace: true });
      // Scroll to top of the feed so the user lands at the start
      // of the grid, not wherever they were last reading.
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [navigate]);

  // Native shell logo tap → full home reset. The Flutter wrapper hides the web
  // header-left (and its logo) and renders its own native logo, so it can't
  // call handleLogoClick directly; it dispatches this bridge event instead.
  // CRITICAL: 'catalog:go-home' is part of the shell contract (see the Bridge
  // Events table in CLAUDE.md) — do not rename without updating catalog-flutter.
  useEffect(() => {
    const onGoHome = () => handleLogoClick();
    window.addEventListener('catalog:go-home', onGoHome);
    return () => window.removeEventListener('catalog:go-home', onGoHome);
  }, [handleLogoClick]);

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

  const handleOpenLook = useCallback((look: Look, opts?: { bypassGate?: boolean; nav?: NavMode }) => {
    const nav = opts?.nav ?? 'push';
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

    // Guest gate. Products are open; looks are a "feature". A shared /l/
    // link (bypassGate) always plays fully so sharing still works. The
    // first in-app look a guest opens plays free (a real taste); every one
    // after that plays for ~1s then dissolves into the signup scrim.
    if (lookTeaseTimer.current) { window.clearTimeout(lookTeaseTimer.current); lookTeaseTimer.current = null; }
    setSelectedLook(look);
    // Record the look as a new LAYER on the trail + mirror the URL. A fresh
    // open from the bare feed (no surface up) starts a new trail.
    if (nav !== 'none') {
      const slug = navSlugForLook(look);
      // 'seed' (a URL-driven rebuild from the resolver) REPLACES the trail
      // with this single frame — there's no meaningful in-memory trail to
      // append to, and replacing (instead of clear-then-append) lets the
      // Back fallback skip the bare-feed flash. 'push' from the bare feed
      // also starts fresh.
      const fresh = nav === 'seed' || (nav === 'push' && !selectedProductRef.current && !selectedLookRef.current);
      const frame: NavFrame = { key: ++navSeqRef.current, kind: 'look', slug, look };
      setNav(s => [...(fresh ? [] : s), frame]);
      if (nav === 'push' && slug && window.location.pathname !== `/l/${slug}`) {
        window.history.pushState({}, '', `/l/${slug}`);
      }
    }
    if (!waitlistMode && isGuest(user) && !opts?.bypassGate) {
      if (hasUsedFreeLook()) {
        // Stash the look so we can drop them right back into it post-signup.
        if (look.uuid) setGuestIntent({ kind: 'look', uuid: look.uuid });
        lookTeaseTimer.current = window.setTimeout(() => {
          setGuestGate({ variant: 'look' });
          lookTeaseTimer.current = null;
        }, 1000);
      } else {
        markFreeLookUsed();
      }
    }
  }, [user, waitlistMode]);

  const handleCloseLook = useCallback(() => {
    // Drop any pending look-teaser timer + the signup scrim so closing the
    // look returns the guest cleanly to the feed.
    if (lookTeaseTimer.current) { window.clearTimeout(lookTeaseTimer.current); lookTeaseTimer.current = null; }
    setGuestGate(null);
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
    // Cold-load / no /l/ entry to pop: reset the address bar to the
    // catalog root so returning to the feed doesn't strand a stale
    // /l/<slug> URL (the share-link case).
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.history.replaceState({}, '', '/');
    }
    setNav(() => []);
    setSelectedLook(null);
  }, [setNav]);

  const handleOpenCreator = useCallback((creatorName: string, opts?: { bypassGate?: boolean }) => {
    // Close every higher-stacked overlay so the creator catalog comes to
    // the foreground. Without nulling selectedProduct/selectedCreative,
    // a tap on a creator pill inside ProductPage's "You might also like"
    // would update the catalog *underneath* the still-visible product
    // page and the click would look like a no-op. Mirrors the close
    // pattern in handleOpenBrand.
    setNav(() => []); // the catalog replaces the detail trail
    setSelectedProduct(null);
    setSelectedCreative(null);
    setSelectedLook(null);
    setBrandFilter(null);
    // Clear any active search so that backing out of the creator catalog
    // lands on the clean main feed — not the search-filtered state the user
    // was typing in when they tapped the creator (which read as the search
    // re-initiating). Also closes the search sheet in BottomBar.
    setSearchQuery('');
    setCatalogName('all');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('catalog:close-search'));
    }
    setCreatorFilter(creatorName);

    // Guest gate. Creator catalogs are a "feature", but we OPEN the catalog
    // first and let it show for a beat, THEN dissolve the signup scrim over
    // it (with a back/X that returns to the feed) — a real taste, not a wall.
    // Shared /c/ links (bypassGate) and the viewer's OWN catalog never gate.
    if (creatorTeaseTimer.current) { window.clearTimeout(creatorTeaseTimer.current); creatorTeaseTimer.current = null; }
    if (!waitlistMode && isGuest(user) && !opts?.bypassGate && !creatorName.startsWith('user:')) {
      setGuestIntent({ kind: 'creator', handle: creatorName });
      creatorTeaseTimer.current = window.setTimeout(() => {
        setGuestGate({ variant: 'creator' });
        creatorTeaseTimer.current = null;
      }, 1100);
    }
  }, [user, waitlistMode]);

  // The global TypeAnywhere search bar dispatches this when a creator
  // autocomplete row is tapped — open that creator's catalog in-app
  // (same path as a creator-chip tap, so /c/<slug> syncs too).
  useEffect(() => {
    const onOpenCreatorEvent = (e: Event) => {
      const handle = (e as CustomEvent<{ handle?: string }>).detail?.handle;
      if (!handle) return;
      setView('app');
      handleOpenCreator(handle);
    };
    window.addEventListener('catalog:open-creator', onOpenCreatorEvent);
    return () => window.removeEventListener('catalog:open-creator', onOpenCreatorEvent);
  }, [handleOpenCreator, setView]);

  const handleCloseCreator = useCallback(() => {
    // Drop any pending creator-teaser timer + the signup scrim so closing the
    // catalog (X / back) returns the guest cleanly to the feed.
    if (creatorTeaseTimer.current) { window.clearTimeout(creatorTeaseTimer.current); creatorTeaseTimer.current = null; }
    setGuestGate(null);
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
    setNav(() => []); // the brand catalog replaces the detail trail
    setSelectedProduct(null);
    setSelectedCreative(null);
    setSelectedLook(null);
    setBrandFilter(null);
    setSearchQuery(brandName);
    setCatalogName(toCatalogName(brandName));
    bumpSearchTrigger();
    lockGenderOverride();
    setHeroMode(true);
    setCeremonyImages([]);
    setCeremony({ active: true, query: brandName, kind: 'brand' });
  }, [bumpSearchTrigger, lockGenderOverride, setNav]);

  const handleCloseBrand = useCallback(() => {
    setBrandFilter(null);
  }, []);

  // Brand tap FROM A PRODUCT PAGE opens the brand's catalog (BrandPage)
  // instead of re-running the search ceremony — coming from search, the
  // ceremony path just landed the shopper back on what looked like their
  // old search results. Trail semantics match handleOpenLook: the product
  // surface closes and the brand catalog takes its place.
  const handleOpenBrandCatalog = useCallback((brandName: string) => {
    if (!brandName) return;
    setNav(() => []); // the brand catalog replaces the detail trail
    setSelectedProduct(null);
    setSelectedCreative(null);
    setSelectedSimilar(null);
    setSimilarCreatives(null);
    setBrandCreatives(null);
    setProductOpenedFromLook(null);
    setBrandFilter(brandName);
  }, [setNav]);

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
    // Monetize the clickout: wrap the merchant URL in the Shopnomix
    // redirect (creator attribution rides along via the recorded cid).
    // Analytics below keep the ORIGINAL url so per-merchant reporting
    // is unchanged.
    const outboundUrl = affiliateRedirect(url, product as { brand?: string | null; name?: string | null; id?: string | null });
    if (!inNativeShell) {
      window.open(outboundUrl, '_blank', 'noopener,noreferrer');
    } else {
      setBrowserState({ url: outboundUrl, title, product });
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

  // Keep the affiliate click-attribution context in sync with whatever
  // surface is on screen: a look attributes to its creator, the creator
  // catalog/profile to that creator, products opened FROM a look keep
  // the look's creator, everything else is house traffic.
  useEffect(() => {
    const fromLook = selectedLook ?? productOpenedFromLook;
    setAffiliateContext({
      creatorHandle: fromLook?.creator ?? creatorFilter ?? null,
      lookId: fromLook ? String(fromLook.uuid || fromLook.id || '') || null : null,
      surface: selectedLook ? 'look'
        : productOpenedFromLook ? 'look-product'
        : creatorFilter ? 'creator-catalog'
        : brandFilter ? 'brand'
        : selectedProduct ? 'product'
        : 'feed',
    });
  }, [selectedLook, productOpenedFromLook, creatorFilter, brandFilter, selectedProduct]);

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

  const handleOpenProduct = useCallback(async (product: Product, opts?: { nav?: NavMode }) => {
    const nav = opts?.nav ?? 'push';
    if (nav === 'push') pushRecent(product);
    // Close the saved overlay if it's open so the product page isn't hidden
    // behind it (the look path already does this via handleBookmarksOpenLook).
    setShowBookmarks(false);
    // Pause every currently-playing <video> before a FRESH nav lands so we
    // don't briefly have two heroes + a rail of cards all decoding at once.
    // Skip on a Back-restore (nav!=='push'): the revealed surface's videos are
    // already attached/paused, and brute-pausing them here leaves the hero
    // frozen because nothing re-plays it (see the top-layer resume effect).
    if (nav === 'push') pauseAllVideos();
    // Remember the look the user came from (if any) so the back button
    // on ProductPage returns to that look instead of the empty feed. On a
    // memory restore (nav:'none') the caller sets this from the frame below.
    if (nav === 'push') setProductOpenedFromLook(selectedLook);
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
    let frameCreative: ProductAd | null = null;
    if (productVideoUrl) {
      frameCreative = {
        // Stable, non-empty id so the hero's TrailVideoHost slot keys correctly.
        // An empty id ('') left the pooled <video> unkeyed — on desktop (large
        // pool) it attached a posterless black element over the poster image
        // (product-from-look opened to a black hero); mobile's tight pool
        // evicted it so the poster showed. Mirror ProductPage's own fallback id.
        id: (product as Product & { creative_id?: string }).creative_id
          || `product:${product.brand}-${product.name}`,
        product_id: (product as Product & { id?: string }).id || '',
        look_id: null,
        title: product.name,
        description: null,
        video_url: productVideoUrl,
        mobile_video_url: null,
        hls_url: product.primary_hls_url || null,
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
      };
      setSelectedCreative(frameCreative);
    } else {
      setSelectedCreative(null);
    }
    setSelectedProduct(product);
    setSelectedSimilar(null);
    setSimilarCreatives(null);
    setBrandCreatives(null);
    setGraphPairs(null);

    // Record the product as a new LAYER on the trail + mirror the URL. A fresh
    // open from the bare feed (no surface up) starts a new trail.
    if (nav !== 'none') {
      const slug = navSlugForProduct(product);
      // 'seed' (a URL-driven rebuild from the resolver) REPLACES the trail
      // with this single frame — there's no meaningful in-memory trail to
      // append to, and replacing (instead of clear-then-append) lets the
      // Back fallback skip the bare-feed flash. 'push' from the bare feed
      // also starts fresh.
      const fresh = nav === 'seed' || (nav === 'push' && !selectedProductRef.current && !selectedLookRef.current);
      const frame: NavFrame = { key: ++navSeqRef.current, kind: 'product', slug, product, creative: frameCreative };
      setNav(s => [...(fresh ? [] : s), frame]);
      if (nav === 'push' && slug && window.location.pathname !== `/p/${slug}`) {
        window.history.pushState({}, '', `/p/${slug}`);
      }
    }

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
      // direct id or a url to resolve from). Skipped on a back/restore so
      // re-showing a product from memory doesn't double-count impressions.
      if (nav === 'push' && (directId || product.url)) void trackCreativeImpressions(productId, null, context);
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
      // Products opened from a look/search/recents can arrive WITHOUT the
      // live primary video inline (the look's cached product data may
      // predate the render). Fetch it and patch selectedProduct so the
      // desktop hero plays the primary video instead of a static poster —
      // ProductPage synthesizes a video hero from product.video_url.
      if (!productVideoUrl && supabase) {
        void supabase
          .from('products')
          .select('primary_video_url, primary_video_poster_url, primary_image_url, image_url')
          .eq('id', productId)
          .maybeSingle()
          .then(({ data }) => {
            const vurl = (data?.primary_video_url as string | null) || null;
            if (!vurl) return;
            const poster = (data?.primary_video_poster_url
              || data?.primary_image_url
              || data?.image_url
              || product.image
              || (product as Product & { thumbnail_url?: string }).thumbnail_url
              || null) as string | null;
            const patch = (p: Product): Product =>
              p.url === product.url && p.name === product.name
                ? { ...p, video_url: vurl, thumbnail_url: poster ?? (p as Product & { thumbnail_url?: string }).thumbnail_url }
                : p;
            setSelectedProduct(prev => (prev ? patch(prev) : prev));
            // The layered render reads frame.product, so patch the matching
            // frame too — otherwise the upgraded video never reaches the hero.
            setNav(s => s.map(f =>
              f.kind === 'product' && f.product.url === product.url && f.product.name === product.name
                ? { ...f, product: patch(f.product) }
                : f,
            ));
          });
      }
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
  const handleOpenCreative = useCallback(async (creative: ProductAd, opts?: { nav?: NavMode }) => {
    if (!creative.product) return;
    const nav = opts?.nav ?? 'push';
    // Close the saved overlay if open so the product page isn't hidden behind it.
    setShowBookmarks(false);
    // Debounce: while the morph is still in flight (~360ms), ignore extra
    // taps. Without this, a user double-tapping a card double-fires
    // setSelectedCreative which races the layoutId animation and produces a
    // jitter. 240ms gives a 100ms head-start grace beyond morph end. Only
    // guards genuine in-app taps — a back/restore must never be swallowed.
    const now = performance.now();
    if (nav === 'push') {
      if (now - lastOpenAtRef.current < 240) return;
      lastOpenAtRef.current = now;
    }

    // Product→product (a product page is already open, e.g. tapping a
    // "More like this" tile): drop the PREVIOUS product's rails immediately
    // so the new page never flashes the old one before its data loads. The
    // in-page tiles don't rely on the feed's layoutId morph, and the hero
    // paints the tapped creative's poster instantly — so the swap is clean
    // and instant. On a fresh feed→product open the ref is null, so we skip
    // this and keep the feed card's morph untouched.
    if (selectedProductRef.current) {
      setSimilarCreatives(null);
      setBrandCreatives(null);
      setGraphPairs(null);
      setSelectedSimilar(null);
    }

    // Fire impressions for the primary product + every other product in the
    // associated look (if any). Fire-and-forget — don't await so navigation
    // is never blocked by the look_products query. Skipped on a back/restore
    // so re-showing from memory doesn't double-count.
    if (nav === 'push') void trackCreativeImpressions(
      creative.product.id || null,
      creative.look_id || null,
      [creative.product.brand, creative.product.name].filter(Boolean).join(' · ').slice(0, 200),
    );

    // Carry over the EXACT image the feed card already painted so the
    // product-page hero never opens to black. The canonical creative chains
    // (services/media-resolver) are the same ones the card paints, so the
    // loaded image always hands off — image-only products (plants, candles)
    // included.
    const mapped: Product & { id?: string } = {
      id: creative.product.id || undefined,
      name: creative.product.name || 'Shop Now',
      brand: creative.product.brand || '',
      price: creative.product.price || '',
      url: creative.product.url || '',
      image: creativeStill(creative) || undefined,
      // Secondary poster slot the hero falls back to (heroStill chain).
      thumbnail_url: creativePoster(creative) || undefined,
    };
    if (nav === 'push') pushRecent(mapped);
    if (nav === 'push') pauseAllVideos(); // skip on Back-restore — see handleOpenProduct
    // On a memory restore (nav:'none') the caller sets this from the frame
    // below; a fresh open records the look the shopper came from.
    if (nav === 'push') setProductOpenedFromLook(selectedLook);
    setSelectedLook(null);
    setSelectedProduct(mapped);
    setSelectedCreative(creative);
    // Record the product as a new LAYER on the trail + mirror the URL. A fresh
    // open from the bare feed (no surface up) starts a new trail.
    if (nav !== 'none') {
      const slug = navSlugForProduct(mapped);
      // 'seed' (a URL-driven rebuild from the resolver) REPLACES the trail
      // with this single frame — there's no meaningful in-memory trail to
      // append to, and replacing (instead of clear-then-append) lets the
      // Back fallback skip the bare-feed flash. 'push' from the bare feed
      // also starts fresh.
      const fresh = nav === 'seed' || (nav === 'push' && !selectedProductRef.current && !selectedLookRef.current);
      const frame: NavFrame = { key: ++navSeqRef.current, kind: 'product', slug, product: mapped, creative };
      setNav(s => [...(fresh ? [] : s), frame]);
      if (nav === 'push' && slug && window.location.pathname !== `/p/${slug}`) {
        window.history.pushState({}, '', `/p/${slug}`);
      }
    }
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
    // Fire the independent boot reads in parallel with the feed fetch so they
    // collapse into the first wave instead of serializing after the grid
    // renders: prefetchDials() batches all app_settings dials into one query,
    // prefetchHiddenContent() warms the admin-hidden sets early, and
    // hydrateVideoPipeline() refreshes the HLS/MP4 pipeline dial (it boots
    // from a localStorage snapshot, so this read just confirms + goes live).
    void prefetchDials();
    void hydrateVideoPipeline();
    prefetchHiddenContent();
    getLooks().then(rows => { if (!cancelled) setLiveLooks(rows); }).catch(() => {});
    // Warm the "Jump into a catalog" pills + Following cache while the feed
    // loads so the search sheet renders them instantly instead of fetching on
    // open. App-only (the native shell has no launch UX to mask the fetch);
    // low priority, so run it on idle behind the feed.
    if (document.documentElement.dataset.shell === 'catalog-app') {
      const ric = (window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      }).requestIdleCallback;
      const warm = () => {
        void getPopularCatalogPills().catch(() => {});
        void getMyFollowing().catch(() => {});
      };
      ric ? ric(warm, { timeout: 2000 }) : window.setTimeout(warm, 600);
    }
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
        // Batch-warm brand logos from the feed's products in a single query
        // instead of the per-brand tier-1 lookup each card fires on mount.
        void prefetchBrandLogos(rows.map(r => r.product).filter((p): p is NonNullable<typeof p> => !!p));
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
    const apply = () => {
      setSelectedProduct(null);
      setSelectedLook(null);
      setSearchQuery(query);
      // Crown the catalog with a fun, on-topic name derived from the query
      // ("I need a dress for italy" → "Italy-Coded Dresses").
      const trimmed = query.trim();
      setCatalogName(trimmed ? funnyCatalogName(trimmed) : 'all');
    };
    // Mobile: if a text input is focused (keyboard up), dismiss it FIRST
    // and let it start sliding down before the loading ceremony mounts —
    // otherwise the loading animates up behind the keyboard. The URL/?q=
    // path has no focused input, so it applies immediately.
    const active = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    const keyboardUp = !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
    if (typeof window !== 'undefined' && window.innerWidth <= 768 && keyboardUp) {
      active!.blur();
      window.setTimeout(apply, 180);
      return;
    }
    apply();
  }, []);

  // The TypeAnywhere overlay (mounted in root.tsx) lands new
  // searches on /?q=<query>. Read the param on every URL change,
  // apply it, then strip it so refresh / share doesn't re-fire.
  // Also forces view='app' so the user lands on the grid even if
  // they were on the password gate.
  const location = useLocation();
  // A ?q= present in the URL when the app FIRST loads (a shared/bookmarked
  // deep link, or an external link into a search) should go STRAIGHT to the
  // results catalog — no search ceremony. An in-app TypeAnywhere search
  // (navigate('/?q=…') AFTER mount) still plays the ceremony. We tell them
  // apart by remembering the q that was in the URL at mount and consuming it
  // once (the OAuth round-trip can defer the first real handling, so we key
  // off "first q actually processed that matches the mount q", not the first
  // render).
  const initialQRef = useRef<string | null>(
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('q') : null,
  );
  const initialQConsumedRef = useRef(false);
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
    // Deep link → the q was in the URL at first load. Skip the ceremony and
    // drop the shopper straight onto the results catalog.
    const isDeepLink = !initialQConsumedRef.current && q === initialQRef.current;
    if (isDeepLink) initialQConsumedRef.current = true;
    handleCreateCatalog(q);
    if (isDeepLink) {
      // Suppress the ceremony the searchTrigger bump below would otherwise
      // play, and reveal the results catalog immediately (same end-state as
      // handleCeremonyDone, minus the loading animation).
      suppressCeremonyRef.current = true;
      if (!inShell) setHeroMode(false);
      setRevealResults(true);
      window.setTimeout(() => setRevealResults(false), 950);
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
    bumpSearchTrigger();
    setView('app');
    params.delete('q');
    const remaining = params.toString();
    const url = `${window.location.pathname}${remaining ? `?${remaining}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, '', url);
  }, [location.search, handleCreateCatalog]);

  // Deep-link to a look's screen via /?look=<uuid>. The activity page's
  // "Your looks" rail uses this to open a finished render's look overlay.
  // Resolve the uuid against the live look set, open the overlay, then
  // strip the param so refresh/share doesn't re-fire.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(location.search);
    const lookUuid = params.get('look');
    if (!lookUuid) return;
    if (params.has('code') || params.has('error_description')) return;
    let cancelled = false;
    (async () => {
      try {
        // Live looks come from the cached public set; an inactive/unpublished
        // look (e.g. a creator's fresh render) isn't in there, so fall back to
        // a direct status-agnostic fetch.
        const all = await getLooks();
        const look = all.find(l => l.uuid === lookUuid) ?? await getLookByUuid(lookUuid);
        if (!cancelled && look) {
          setView('app');
          // ?look= is a deep link (Activity "Your looks", shared) — play fully.
          handleOpenLook(look, { bypassGate: true });
        }
      } catch { /* ignore — look may have been removed */ }
    })();
    params.delete('look');
    const remaining = params.toString();
    const url = `${window.location.pathname}${remaining ? `?${remaining}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, '', url);
    return () => { cancelled = true; };
  }, [location.search, handleOpenLook]);

  // Replay guest intent after signup. When a guest hits the look/creator
  // gate we stash what they were reaching for; once a session resolves
  // (including after the Google OAuth redirect round-trip, where this fires
  // on the fresh boot's null→user transition) we drop them straight into
  // it — the single biggest conversion lift.
  const prevUserRef = useRef(user);
  useEffect(() => {
    const wasGuest = !prevUserRef.current;
    prevUserRef.current = user;
    if (!user || !wasGuest) return;
    const intent = takeGuestIntent();
    if (!intent) return;
    setGuestGate(null);
    setView('app');
    let cancelled = false;
    (async () => {
      if (intent.kind === 'creator') {
        handleOpenCreator(intent.handle, { bypassGate: true });
        return;
      }
      try {
        const all = await getLooks();
        const look = all.find(l => l.uuid === intent.uuid) ?? await getLookByUuid(intent.uuid);
        if (!cancelled && look) handleOpenLook(look, { bypassGate: true });
      } catch { /* look removed — land on the feed */ }
    })();
    return () => { cancelled = true; };
  }, [user, handleOpenLook, handleOpenCreator, setView]);

  const toggleTheme = useCallback(() => {
    setIsLightMode(prev => !prev);
  }, []);

  // Header / BottomBar / UserMenu callbacks. Stable refs so the memo
  // wrappers on BottomBar and UserMenu actually cut renders - inline
  // arrow functions in JSX would create new identities every render.
  const openBookmarks = useCallback(() => setShowBookmarks(true), []);
  const openMyLooks = useCallback(() => {
    // Reflect My Catalog in the URL so it's shareable / back-navigable
    // (matches the Flutter bridge opener that already pushes /my-looks).
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/my-looks')) {
      history.pushState({}, '', '/my-looks');
    }
    setShowMyLooks(true);
  }, []);
  // Cold load / refresh at /my-looks: open the My Catalog overlay so the
  // deep link doesn't render a blank feed behind the URL.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/my-looks')) {
      setShowMyLooks(true);
    }
  }, []);
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

  // Single Back owner for the detail trail. Every product/look open records a
  // frame in navStackRef (the full entity, in memory) and mirrors the URL.
  // Pressing browser Back (or the X button, which calls history.back()) pops
  // a history entry and fires popstate here; we pop the matching frame and
  // restore the previous surface FROM MEMORY — synchronously, no network
  // re-resolve and no clear-to-feed gap. (This replaced the old design where
  // a second popstate listener in useOverlayRouter async-refetched the slug,
  // which caused the back-nav lag, the feed/white flash, and the stuck-on-A
  // loop.) The listener never pushes history — only the open handlers do —
  // so the stack can't accumulate duplicate entries.
  //
  // We use refs so the listener doesn't reattach on every state change — it
  // reads the live state through .current at fire time, staying stable.
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

    // Clear the product + look detail surfaces (the whole in-memory trail)
    // back to the bare feed. Shared by the "left the trail" and "landed on a
    // catalog" branches.
    const clearTrail = () => {
      setSelectedProduct(null);
      setSelectedCreative(null);
      setSelectedSimilar(null);
      setSimilarCreatives(null);
      setBrandCreatives(null);
      setGraphPairs(null);
      setSelectedLook(null);
      setProductOpenedFromLook(null);
    };

    // Re-show a product/look detail surface straight FROM MEMORY: no slug
    // re-resolve, no network refetch, no clear-to-feed flash. nav:'none'
    // tells the open handler to set state + reload the (below-the-fold) rails
    // WITHOUT pushing a fresh history entry or stack frame — the browser
    // already popped to this entry and the frame is already in the stack. All
    // the setState calls below batch into a single commit inside this one
    // discrete popstate event, so the destination paints in one frame.
    const restoreFrame = (frame: NavFrame, under: NavFrame | undefined) => {
      markOverlayReturn(frame.slug); // restore the surface's saved scroll
      if (frame.kind === 'product') {
        const underLook = under && under.kind === 'look' ? under.look : null;
        setProductOpenedFromLook(underLook);
        if (frame.creative) handleOpenCreative(frame.creative, { nav: 'none' });
        else handleOpenProduct(frame.product, { nav: 'none' });
      } else {
        handleOpenLook(frame.look, { nav: 'none', bypassGate: true });
      }
    };

    const onPop = () => {
      const path = window.location.pathname;
      const onProduct = path.startsWith('/p/');
      const onLook    = path.startsWith('/l/');
      const onBrand   = path.startsWith('/b/');
      const onCreator = path.startsWith('/c/');
      const onComments = path.startsWith('/comments/');

      // Comments overlay exit: URL left /comments/ but the overlay is still
      // open → user backed out of the thread. Clear it; the product/look it
      // sat on top of stays mounted underneath, untouched.
      if (!onComments && commentsTargetRef.current) setCommentsTarget(null);
      // Brand / creator catalog exits — URL left /b/ or /c/.
      if (!onBrand && brandFilterRef.current) setBrandFilter(null);
      if (!onCreator && creatorFilterRef.current) setCreatorFilter(null);

      // Landed back ON a brand/creator catalog: close any product/look surface
      // stacked above it (keep the catalog itself). Their own URL sync lives
      // in useOverlayRouter, so don't let the detail-trail reconcile fight it.
      if (onBrand || onCreator) {
        setNav(() => []);
        if (selectedProductRef.current || selectedLookRef.current) clearTrail();
        return;
      }

      // ── Detail trail (product / look): restore the destination from MEMORY ──
      if (onProduct || onLook) {
        const slug = decodeURIComponent(path.slice(3));
        // Already showing exactly this surface (e.g. backing out of a comments
        // overlay that sat on top of it) → no-op, so we never needlessly
        // remount the page we're already on.
        const showingProduct = !!selectedProductRef.current && !selectedLookRef.current;
        const showingLook = !!selectedLookRef.current && !selectedProductRef.current;
        if (onProduct && showingProduct && navSlugForProduct(selectedProductRef.current!) === slug) return;
        if (onLook && showingLook && navSlugForLook(selectedLookRef.current!) === slug) return;

        // Find the destination frame in the stack (walk from the top down).
        const stack = navStackRef.current;
        let idx = -1;
        for (let i = stack.length - 1; i >= 0; i--) {
          const f = stack[i];
          if (f.slug !== slug) continue;
          if ((onProduct && f.kind === 'product') || (onLook && f.kind === 'look')) { idx = i; break; }
        }
        if (idx >= 0) {
          const sliced = stack.slice(0, idx + 1);
          setNav(() => sliced);
          restoreFrame(sliced[idx], sliced[idx - 1]);
        } else {
          // Not in memory (forward nav, a back after the trail was reset, or a
          // cold/shared link) → re-resolve off the URL asynchronously. The
          // resolver seeds a single fresh frame (nav:'seed' now REPLACES the
          // trail), so we deliberately DON'T clear here first — keeping the
          // outgoing layer mounted until the seed lands avoids the flash of
          // bare feed underneath ("jumps to the feed then back to the page").
          if (onProduct) openProductFromSlugRef.current?.(slug);
          else openLookFromSlugRef.current?.(slug);
        }
        return;
      }

      // ── Left the detail trail entirely (path '/', '/?q=', …) → close it. ──
      // Do NOT touch scroll here (founder's call — back must land you exactly
      // where you were in the feed); the overlay-lock cleanup restores the
      // saved scrollY, and a scrollTo here would clobber it.
      setNav(() => []);
      if (selectedProductRef.current || selectedLookRef.current) clearTrail();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // handle* are stable useCallbacks; the refs above carry the live state.
    // Deliberately empty deps so the listener attaches exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Address-bar safety net. The trail normally cleans its own URL via the
  // browser pop, but if every detail/catalog surface closes while the bar is
  // still stranded on a /p/ or /l/ URL — e.g. a late async resolve that got
  // superseded, or any state-only clear — normalize it back to '/'. Gated on
  // having actually HAD a surface open (hadDetailRef) so a cold-load /p/ deep
  // link isn't wiped before its resolver opens it.
  const hadDetailRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const anyOverlay = !!selectedProduct || !!selectedLook || !!creatorFilter || !!brandFilter;
    if (anyOverlay) { hadDetailRef.current = true; return; }
    if (!hadDetailRef.current) return;
    const p = window.location.pathname;
    if (p.startsWith('/p/') || p.startsWith('/l/')) {
      window.history.replaceState({}, '', '/');
    }
  }, [selectedProduct, selectedLook, creatorFilter, brandFilter]);

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
    // In the native shell, the NATIVE Supabase session is the source of truth
    // that drives the app's AuthGate. Logging out only on the web side leaves
    // the app "signed in" (it just shows the web sign-in gate inside the still
    // signed-in shell). Tell the shell to sign out natively; it re-injects and
    // flips back to the native LoginScreen. The web logout still runs as a
    // fallback (and is the only path on mobile web).
    if (
      typeof window !== 'undefined' &&
      document.documentElement.dataset.shell === 'catalog-app' &&
      (window as unknown as { flutter_inappwebview?: { callHandler: (n: string) => void } }).flutter_inappwebview
    ) {
      try {
        (window as unknown as { flutter_inappwebview: { callHandler: (n: string) => void } })
          .flutter_inappwebview.callHandler('catalogSignOut');
      } catch { /* not in shell / bridge unavailable */ }
    }
    await logout();
    setView('locked');
  }, [logout]);
  const handleSearchChange = useCallback((q: string) => {
    setSearchQuery(q);
    setCatalogName(q.trim() ? toCatalogName(q) : 'all');
  }, []);
  const handleSelectSuggestion = useCallback((q: string) => {
    setSearchQuery(q.toLowerCase());
    setCatalogName(funnyCatalogName(q));
    bumpSearchTrigger();
    // The searchTrigger effect plays the ceremony when on the hero.
  }, []);
  const handleOpenLilyCreator = useCallback(() => setCreatorFilter('@lilywittman'), []);
  // Overlay chrome search: close every overlay and run the query on the
  // feed (same destination the home search lands on).
  const handleOverlaySearch = useCallback((q: string) => {
    const query = q.trim();
    if (!query) return;
    setNav(() => []); // search is a fresh start — abandon the trail
    setSelectedProduct(null);
    setSelectedCreative(null);
    setSelectedLook(null);
    setBrandFilter(null);
    setCreatorFilter(null);
    setShowBookmarks(false);
    setShowMyLooks(false);
    setHeroMode(false);
    if (typeof window !== 'undefined') {
      if (window.location.pathname !== '/') window.history.replaceState({}, '', '/');
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
    setSearchQuery(query);
    bumpSearchTrigger();
  }, [inShell, setSearchQuery, bumpSearchTrigger]);

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
    setNav(() => []);
    setSelectedProduct(null);
    setSelectedCreative(null);
    setSelectedSimilar(null);
    setSimilarCreatives(null);
    setBrandCreatives(null);
    setGraphPairs(null);
    if (productOpenedFromLook) {
      setNav(() => [{
        key: ++navSeqRef.current,
        kind: 'look',
        slug: navSlugForLook(productOpenedFromLook),
        look: productOpenedFromLook,
      }]);
      setSelectedLook(productOpenedFromLook);
      setProductOpenedFromLook(null);
      return;
    }
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/p/')) {
      window.history.replaceState({}, '', '/');
    }
  }, [productOpenedFromLook]);

  // URL ↔ overlay state binding. The router now owns ONLY: the /b/ and /c/
  // URL mirror (brand/creator catalogs), the cold-load deep-link consumer
  // (open the entity a shared /p//l//b//c/ URL points at), and the async
  // slug→entity resolvers. The product/look push + the Back reconcile moved
  // in-house (the open handlers push frames + URL; the popstate listener
  // above restores from memory). The resolvers are the fallback for a popped
  // slug that isn't in the in-memory stack.
  // Deep-link opens (a shared /l/ or /c/ URL, or forward-nav to one) bypass
  // the guest gate so shared links always play — only in-app taps gate.
  const handleOpenLookDeepLink = useCallback(
    (look: Look, opts?: { nav?: NavMode }) => handleOpenLook(look, { bypassGate: true, ...opts }),
    [handleOpenLook],
  );
  const handleOpenCreatorDeepLink = useCallback((handle: string) => handleOpenCreator(handle, { bypassGate: true }), [handleOpenCreator]);
  const { openProductFromSlug, openLookFromSlug } = useOverlayRouter({
    selectedProduct,
    selectedLook,
    brandFilter,
    creatorFilter,
    onOpenProduct: handleOpenProduct,
    onOpenCreative: handleOpenCreative,
    onOpenLook: handleOpenLookDeepLink,
    onOpenBrand: handleOpenBrand,
    onOpenCreator: handleOpenCreatorDeepLink,
  });
  // Surface the resolvers to the (empty-dep) popstate listener above.
  openProductFromSlugRef.current = openProductFromSlug;
  openLookFromSlugRef.current = openLookFromSlug;

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

  // The SPA no longer uses a service worker (Vercel already serves hashed
  // assets `immutable`). Proactively retire any SW a returning visitor still
  // has registered and purge its caches, so stale chunk hashes can't hang nav.
  // Same pass reclaims orphaned localStorage: the daily-feed order is no longer
  // persisted (it re-validates every load), and old home-feed cache versions
  // (v8→v12, gender variants) linger forever otherwise — sweep both so the
  // shopper's storage stays small and can't fill the quota.
  useEffect(() => {
    retireServiceWorker();
    pruneStalePersistedOrders();
    pruneStaleHomeFeedCaches();
  }, []);

  // Trail depth: while the product/look overlay is open, the under-layer
  // (header + grid) recedes a hair (scale 0.985, 4px blur). Subtle parallax
  // that signals "what you tapped is now the focus" without feeling theatrical.
  // brandFilter/showFollowing are full-screen overlays with NO URL path of
  // their own, so the Flutter shell (which keys off path or .has-overlay) can't
  // otherwise tell they're open — include them here so .has-overlay is set and
  // the native header hides over them. On web this only adds pointer-events:none
  // on the receding under-layer (harmless; prevents tap-through).
  const overlayOpen =
    !!selectedProduct || !!selectedLook || !!brandFilter || showFollowing;

  // Home top-edge pull → open the people & brands page. Honour it only when
  // the home feed is the active surface (no look/product/creator/brand/gate
  // already up), so the global gesture can't fire over another screen.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOpenPeople = () => {
      // Rejected (not the home surface) → let the peeked panel slide back.
      if (view !== 'app' || overlayOpen || creatorFilter || brandFilter || guestGate || showBookmarks || showMyLooks) {
        snapPeople(false);
        return;
      }
      setPeopleOpen(true);
      snapPeople(true);
    };
    window.addEventListener('catalog:open-people', onOpenPeople);
    return () => window.removeEventListener('catalog:open-people', onOpenPeople);
  }, [view, overlayOpen, creatorFilter, brandFilter, guestGate, showBookmarks, showMyLooks]);

  // Guest scroll nudge — once a guest has scrolled a few screens of feed,
  // dissolve in the soft "register for your daily feed" popup. Cadence
  // (services/guest): show once at ~3 screens, re-nudge once deeper at ~8,
  // then rest for the session. Never fires while a look/product/creator
  // overlay is open (the nudge belongs to the feed) or once a gate is up.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (waitlistMode || !isGuest(user) || view !== 'app') return;
    if (overlayOpen || creatorFilter || brandFilter || guestGate) return;
    const onScroll = () => {
      const shown = getNudgeCount();
      if (shown >= 2) { window.removeEventListener('scroll', onScroll); return; }
      const screensDeep = shown === 0 ? 3 : 8;
      if (window.scrollY > window.innerHeight * screensDeep) {
        bumpNudgeCount();
        setGuestGate({ variant: 'feed' });
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [user, view, overlayOpen, creatorFilter, brandFilter, guestGate, waitlistMode]);

  // Lock the underlying feed while a product/look overlay is open so
  // swipe-down-to-dismiss only moves the overlay, not the page beneath.
  // iOS Safari needs position:fixed + saved scrollY (not just overflow:
  // hidden) for this to actually stop the body from scrolling. On close
  // we restore the prior scroll position so the shopper lands exactly
  // where they tapped — no jump to the top.
  useEffect(() => {
    if (!overlayOpen) return;
    if (typeof window === 'undefined') return;
    // NOTE: the mobile document-scroll overlay mode (.look-doc-scroll /
    // .product-doc-scroll) was removed — it forced the overlay to
    // position:static (nullifying its z-index, so product/look pages opened
    // UNDER the feed) and made .product-page overflow:visible (which broke the
    // nested "Popular" feed's IntersectionObserver into a runaway that pushed
    // its cards off-screen). Overlays now always use the inner-scroll +
    // body-lock path below, where z-index stacking is intact. The only cost is
    // iOS Safari's cosmetic toolbar-frost strip on detail pages.
    const scrollY = window.scrollY;
    // Freeze the chrome/hero scroll-trackers for the whole overlay lifecycle so
    // the position:fixed jump (and the close-time restore) can't reposition the
    // search bar. Set BEFORE locking the body so the open-time synthetic scroll
    // is already ignored.
    overlayScrollLockRef.current = true;
    // When the overlay is opened from deep in the feed, retire the search bar to
    // its hidden state so closing returns to a clean full-screen feed — the bar
    // comes back only on a genuine scroll-up (or at the hero top), which is the
    // intended "hidden until you scroll up" behaviour.
    if (scrollY > window.innerHeight * 0.6) setChromeHidden(true);
    const { body, documentElement: html } = document;
    const prev = {
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyWidth: body.style.width,
      bodyOverflow: body.style.overflow,
      htmlOverflow: html.style.overflow,
    };
    // Two lock strategies. On MOBILE we lock with overflow:hidden only and
    // KEEP window.scrollY where it is — this is what lets iOS 26 Safari hold
    // its collapsed (floating-pill) toolbar while the overlay is open. The
    // older position:fixed lock collapses the document to viewport height and
    // snaps scrollY→0, which Safari reads as "scrolled to top" and re-expands
    // its toolbar into the solid dark bar the shopper complained about. The
    // inner scrollers (.product-page / .look-overlay-scroll) carry
    // overscroll-behavior:contain so the held body never scroll-chains.
    // Desktop has no such toolbar; keep the proven position:fixed lock there.
    const lockIsFixed = window.matchMedia('(min-width: 960px)').matches;
    if (lockIsFixed) {
      body.style.position = 'fixed';
      body.style.top = `-${scrollY}px`;
      body.style.width = '100%';
    }
    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    return () => {
      body.style.position = prev.bodyPosition;
      body.style.top = prev.bodyTop;
      body.style.width = prev.bodyWidth;
      body.style.overflow = prev.bodyOverflow;
      html.style.overflow = prev.htmlOverflow;
      if (lockIsFixed) {
        // The fixed lock parked the document at top; restore the saved position.
        window.scrollTo(0, scrollY);
        requestAnimationFrame(() => { overlayScrollLockRef.current = false; });
        return;
      }
      // Overflow lock (mobile): the document never moved WHILE open, but a
      // drag-to-dismiss FLING can carry into the now-unlocked body after the
      // overlay unmounts (overflow:hidden doesn't fully stop an iOS fling),
      // scrolling the revealed feed UP — which re-expands Safari's toolbar into
      // the dark bar and lands the shopper away from where they were. Pin the
      // saved position for a short window until the fling dies, then release.
      let frames = 0;
      const pin = () => {
        window.scrollTo(0, scrollY);
        if (++frames < 20) {
          requestAnimationFrame(pin);
        } else {
          overlayScrollLockRef.current = false;
        }
      };
      requestAnimationFrame(pin);
    };
  }, [overlayOpen]);

  // Resume the hero video of whatever detail layer is now on top. On a Back the
  // revealed layer's hero is left PAUSED — the forward open's pauseAllVideos()
  // (and, on mobile, the browser pausing a visibility:hidden <video>) stopped
  // it, and nothing re-plays it: TrailVideoHost only .play()s on a fresh attach,
  // not on re-reveal of an already-mounted layer. Keyed on the top frame so it
  // fires on every open AND every Back/forward; two rAFs let the layer's
  // visibility flip to visible before we call play() (so WebKit actually paints).
  const topFrameKey = navStack.length ? navStack[navStack.length - 1].key : null;
  useEffect(() => {
    if (topFrameKey == null || typeof window === 'undefined') return;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => {
        const layers = document.querySelectorAll<HTMLElement>('.nav-layer');
        const top = layers[layers.length - 1];
        const hero = top?.querySelector<HTMLVideoElement>('video');
        if (hero && hero.paused) void hero.play().catch(() => { /* autoplay race — director/watchdog retries */ });
      });
    });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [topFrameKey]);

  return (
    <TrailRoot>
    <TrailVideoHost>
    <div className={`app-root ${isLightMode ? 'light-mode' : ''}${overlayOpen ? ' has-overlay' : ''}${heroMode ? ' home-hero' : ''}${heroScrolled ? ' hero-scrolled' : ''}${heroRailInert ? ' hero-rail-inert' : ''}${heroBarFaded ? ' hero-bar-faded' : ''}${chromeHidden ? ' chrome-hidden' : ''}`}>
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
      {CLERK_AUTH_ENABLED
        ? <Suspense fallback={null}><ClerkSignInGate /></Suspense>
        : ((view === 'locked' || showSignIn) && !authLoading && !user && <PasswordGate />)}
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
                selfEntry={
                  (user?.role === 'creator' || user?.role === 'admin' || user?.role === 'super_admin') && user?.id
                    ? { handle: `user:${user.id}`, displayName: user.displayName ?? null, avatarUrl: user.avatarUrl ?? null, ts: Number.MAX_SAFE_INTEGER }
                    : null
                }
                onOpenSelf={openMyLooks}
              />
            </div>
            <PendingLookPill onOpen={(genId) => navigate(genId ? `/generate?gen=${genId}` : '/generate')} />
            <div className="header-right">
              {/* Earnings stays in its original slot. The activity pill
                  moved to the RIGHT of it per the latest spec — earnings
                  is the primary currency indicator, activity is the
                  secondary indicator so it sits after. Mobile-only;
                  desktop keeps the centered toast stack. Tap routes to
                  /activity (a dedicated screen, not the wallet). */}
              <HeaderWalletPill onOpenWallet={openWallet} />
              <HeaderActivityPill />
              {/* Super-admin entry lives under the profile picture now (the
                  Admin quicklink directly below the avatar in UserMenu's
                  popout, and the Super Admin section in the mobile Account
                  page) — no standalone header button so the bar stays clean. */}
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
                onGuestSignup={() => setGuestGate({ variant: 'feed' })}
                onSignIn={() => setShowSignIn(true)}
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

          <div
            className={`home-feed-wrap${revealResults ? ' home-results-reveal' : ''}${(!heroMode && !ceremony.active && searchQuery.trim() !== '' && ceremonyRecs.length > 0) ? ' has-catalog-strip' : ''}`}
            style={{ ['--feed-cols' as string]: feedGridCols } as React.CSSProperties}
          >
          {/* Ceremony Option 1: demographic-aware catalog picks ride as an
              in-flow strip ABOVE the results — the shopper scrolls straight from
              these into the continuous feed below (no blocking picker). Only on a
              resolved search (not the hero, not mid-ceremony). */}
          {!heroMode && !ceremony.active && searchQuery.trim() !== '' && ceremonyRecs.length > 0 && (
            <SearchCatalogStrip
              query={searchQuery}
              recommendations={ceremonyRecs}
              onPick={handlePickRecommendedCatalog}
            />
          )}
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
            hasCatalogStrip={!heroMode && !ceremony.active && searchQuery.trim() !== '' && ceremonyRecs.length > 0}
            onSearchLoadingChange={handleSearchLoadingChange}
            onResultsReady={setCeremonyImages}
            searchTrigger={searchTrigger}
            followedHandles={followingCatalog}
            mySizeOnly={mySizeOnly}
            feedCols={feedGridCols}
          />
          </div>

          {/* Grid-density dial — mobile-only minimal wheel on the right edge of
              the home feed. CSS (feed.css) gates display to <=768px; we only
              MOUNT it on the home feed (no overlay open) so it never sits over a
              look/product. Hidden at the top, fades in once the shopper scrolls
              (feedDialVisible). Tapping ANYWHERE on it cycles 1 → 2 → 3 → 1
              (no need to hit an exact segment); scroll/drag still steps. */}
          {navStack.length === 0 && (
            <div
              ref={feedDialRef}
              className={`feed-view-dial${feedDialVisible ? ' is-visible' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={`Feed grid: ${feedGridCols} column${feedGridCols > 1 ? 's' : ''}. Tap to change.`}
              onClick={cycleFeedCols}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cycleFeedCols(); } }}
            >
              {FEED_GRID_COLS.map((c, i) => (
                <span
                  key={c}
                  className={`feed-view-dial-dot${i === feedColsIndex ? ' is-active' : ''}`}
                  aria-hidden="true"
                >
                  <span className="feed-view-dial-bars">
                    {Array.from({ length: c }).map((_, b) => <i key={b} />)}
                  </span>
                </span>
              ))}
            </div>
          )}

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
            onOpenCreative={handleOpenCreative}
          />

          {/* Recently viewed — a thumbnail strip that rides directly UNDER the
              home search pill (mirrors the account menu). Rendered as a SIBLING
              of the bar (not a child) because .bottom-bar has overflow:hidden
              for its pill clip, which would hide anything below it. Positioned
              + faded by CSS off the same --hero-bar-bottom / --hero-scroll-
              progress the bar uses, so the two stay glued. Mobile, home hero,
              at rest only; only when there's view history. */}
          {heroMode && !ceremony.active && recentProducts.length > 0 && (
            <div className="home-recent-strip" aria-label="Recently viewed">
              <div className="home-recent-title">Recently viewed</div>
              <div className="home-recent-row">
                {recentProducts.slice(0, 12).map((p, i) => (
                  <button
                    key={`${p.brand}|${p.name}|${i}`}
                    type="button"
                    className="home-recent-tile"
                    onClick={() => handleOpenProduct(p)}
                    aria-label={p.name || 'Product'}
                  >
                    {p.image
                      ? <img src={p.image} alt="" loading="lazy" decoding="async" />
                      : <span className="home-recent-tile-empty" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Magical loading screen between a hero search and its results.
              Search ceremonies end on demographic-aware catalog picks; brand
              ceremonies don't (no recs fetched for them). */}
          {ceremony.active && (
            <SearchCeremony
              query={ceremony.query}
              kind={ceremony.kind}
              ready={!searchLoading}
              onDone={handleCeremonyDone}
              floatingImages={ceremonyImages}
              pickMode={ceremony.kind === 'search' && isConversationalQuery(ceremony.query)}
              recs={ceremonyRecs}
              recsReady={ceremonyRecsReady}
              onPickCatalog={handlePickRecommendedCatalog}
            />
          )}

          <button className="remix-btn-fixed" onClick={handleRemix} onContextMenu={handleRemixReset} title="Click to remix · Right-click to reset layout" aria-label="Remix">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          </button>

          {/* ── Detail trail, rendered as LAYERS ──────────────────────────
              Every product/look the shopper opened is a frame in navStack and
              stays MOUNTED here, stacked. The top frame is interactive; the
              ones beneath are warm behind it (covered, pointer-inert, video
              paused by the director's scope stack). Back pops a frame and the
              layer beneath — already mounted — is revealed instantly, with no
              remount, no clear-to-feed gap, no refetch. Each wrapper makes its
              own stacking context (z-index by stack position) so a look opened
              from a product still sits ABOVE that product despite the product
              overlay's higher intrinsic z-index. The top keeps its type's
              natural z (look 200 / product 250) to preserve the chrome
              relationships (bottom-bar at 240, etc.).

              Only the last NAV_MOUNT_WINDOW frames render (1 visible + warm
              behind); deeper frames are data-only and re-mount hidden when a
              Back slides them back into the window. Warm layers are
              visibility:hidden so their z-order among themselves is moot — only
              the visible top needs its natural z. */}
          {navStack.slice(Math.max(0, navStack.length - NAV_MOUNT_WINDOW)).map((frame, j) => {
            const i = Math.max(0, navStack.length - NAV_MOUNT_WINDOW) + j;
            const isTop = i === navStack.length - 1;
            // The layer DIRECTLY beneath the top. It must stay painted so the
            // top's bottom-sheet slide (see product-page.css / look-overlay.css)
            // reveals the PREVIOUS surface as it rides up on open / down on
            // close — a same-type step (look A → look B, product A → product B)
            // then reads as a clean push, not a flash of the home feed.
            const isUnder = i === navStack.length - 2;
            const z = isTop ? (frame.kind === 'product' ? 250 : 200) : 100 + j;
            const layerStyle: React.CSSProperties = {
              position: 'fixed',
              inset: 0,
              zIndex: z,
              pointerEvents: isTop ? undefined : 'none',
              // Covered layers stay MOUNTED (preserved scroll + React state, so
              // Back reveals them instantly). Layers TWO+ deep are hidden from
              // PAINT — the browser stops compositing/painting them, which on
              // mobile were rendering dozens of images + <video>s invisibly
              // behind the opaque top surface. The IMMEDIATE under-layer stays
              // painted (it's the one a slide uncovers); its hero <video> is
              // already paused by the director's scope stack, so the cost is a
              // single occluded poster layer. visibility (not display:none /
              // content-visibility) keeps layout intact, so revealing a deeper
              // layer on Back is a repaint with no relayout hitch.
              visibility: (isTop || isUnder) ? undefined : 'hidden',
            };
            if (frame.kind === 'look') {
              return (
                <div key={frame.key} className="nav-layer" style={layerStyle} aria-hidden={!isTop || undefined}>
                  <Suspense fallback={null}>
                    <LookOverlay
                      look={frame.look}
                      onClose={isTop ? handleCloseLook : noop}
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
                      onDailyFeedBar={noop}
                      onHome={handleLogoClick}
                      onSearch={handleOverlaySearch}
                    />
                  </Suspense>
                </div>
              );
            }
            const under = navStack[i - 1];
            const fromLook = under && under.kind === 'look' ? under.look : null;
            return (
              <div key={frame.key} className="nav-layer" style={layerStyle} aria-hidden={!isTop || undefined}>
                <Suspense fallback={null}>
                  <ProductPage
                    product={frame.product}
                    onClose={isTop ? handleProductClose : noop}
                    onOpenLook={handleOpenLook}
                    onOpenBrowser={handleOpenBrowser}
                    onOpenProduct={handleOpenProduct}
                    onOpenCreator={handleOpenCreator}
                    onOpenCreative={handleOpenCreative}
                    onOpenBrand={handleOpenBrandCatalog}
                    onCreateCatalog={handleCreateCatalog}
                    onOpenComments={openComments}
                    creative={mapCreativeForPage(frame.creative)}
                    similarCreatives={isTop ? (similarCreatives ?? undefined) : undefined}
                    brandCreatives={isTop ? (brandCreatives ?? undefined) : undefined}
                    graphPairs={isTop ? (graphPairs ?? undefined) : undefined}
                    popularFallback={popularFallback}
                    lookCreatives={isTop ? lookCreativesForProduct : undefined}
                    allLooks={liveLooks}
                    fromLook={fromLook}
                    bookmarks={bookmarks}
                    navKey={frame.key}
                    onHome={handleLogoClick}
                    onSearch={handleOverlaySearch}
                  />
                </Suspense>
              </div>
            );
          })}

          {/* Guest freemium gate — dissolves over a look teaser ('look'),
              a creator catalog ('creator'), or the feed scroll nudge
              ('feed'). Looks gate after the first free one; creator
              catalogs always gate; products stay open. */}
          {/* Renders in BOTH launch flows: with the landing retired this
              gate is the only door a signed-out visitor has to sign-in
              (in waitlist flow a fresh signup still routes to the
              waitlist screen after auth). Gating it on !waitlistMode
              made the account button a dead click for guests. */}
          {guestGate && !authLoading && !user && (
            <GuestSignupGate
              variant={guestGate.variant}
              onClose={
                guestGate.variant === 'look' ? handleCloseLook
                : guestGate.variant === 'creator' ? handleCloseCreator
                : () => setGuestGate(null)
              }
              onContinueGuest={guestGate.variant === 'feed' ? () => setGuestGate(null) : undefined}
            />
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

          {/* Pull-down "people & brands" page — opened by the home top-edge
              pull. Continuation of the top creator arc; the avatars ease into
              an orbit of who you follow + the brands you save. */}
          <CreatorConstellation
            open={peopleOpen}
            onClose={() => { setPeopleOpen(false); snapPeople(false); }}
            onOpenCreator={(h) => { setPeopleOpen(false); handleOpenCreator(h); }}
            onOpenBrand={(b) => { setPeopleOpen(false); handleOpenBrand(b); }}
            savedProducts={bookmarks.bookmarkedProducts as unknown as { brand?: string | null; name?: string | null; image?: string | null }[]}
          />

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

          {/* (Product detail surfaces render in the layered detail trail above,
              alongside looks — see the navStack.map.) */}

        </>
      )}

      {browserState && (
        <Suspense fallback={null}>
          <InAppBrowser
            url={browserState.url}
            title={browserState.title}
            product={browserState.product}
            isSaved={browserState.product ? bookmarks.isProductBookmarked(browserState.product) : undefined}
            onToggleSave={browserState.product ? (() => {
              const p = browserState.product!;
              const wasSaved = bookmarks.isProductBookmarked(p);
              bookmarks.toggleProductBookmark(p);
              emitSavedToast({ name: p.name || 'this product', imageUrl: productPoster(p), saved: !wasSaved });
            }) : undefined}
            onClose={handleBrowserClose}
          />
        </Suspense>
      )}
      {/* Persistent-shell child route (null stub — see routes/_app-stub.tsx).
          Rendered so the deep-link URLs resolve to THIS mounted parent without
          remounting it. */}
      <Outlet />
    </div>
    </TrailVideoHost>
    </TrailRoot>
  );
}
