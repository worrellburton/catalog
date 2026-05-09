import { useState, useCallback, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { useLocation, useParams } from '@remix-run/react';
import PasswordGate from '~/components/PasswordGate';
import WaitlistScreen from '~/components/WaitlistScreen';
import SplashScreen from '~/components/SplashScreen';
import ContinuousFeed from '~/components/ContinuousFeed';
import BottomBar from '~/components/BottomBar';
import { TrailVideoHost } from '~/components/TrailVideoHost';
import { TrailRoot } from '~/components/TrailMotion';
import CatalogLogo from '~/components/CatalogLogo';
import UserMenu from '~/components/UserMenu';

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
import { Look, Product, looks as seedLooks } from '~/data/looks';
import {
  productSlug,
  lookSlug,
  brandSlug,
  extractIdPrefix,
  extractLookId,
} from '~/utils/slug';
import { useBookmarks } from '~/hooks/useBookmarks';
import { useRecentProducts } from '~/hooks/useRecentProducts';
import { useAuth } from '~/hooks/useAuth';
import { catalogNames } from '~/data/catalogNames';
import { getWaitlistStatus } from '~/services/waitlist';
import { prefetchSimilarCreatives, prefetchCreativesByBrand, prefetchHomeFeed, setShopperGender, type ProductAd } from '~/services/product-creative';
import { getLooks } from '~/services/looks';
import { getUserGender } from '~/services/genders';
import { primeTrailAssets } from '~/utils/trailPrefetch';
import { supabase } from '~/utils/supabase';
import { registerAssetCache, maybeUnregisterSW } from '~/utils/registerSW';

type AppView = 'locked' | 'splash' | 'landing' | 'app' | 'waitlisted';

// Map individual search words to catalogNames keys so queries like
// "first date fit", "gym fits", or "cozy fall vibes" land on themed names.
const KEYWORD_ALIASES: Record<string, string> = {
  date: 'datenight', dating: 'datenight', romantic: 'datenight', night: 'datenight',
  hot: 'datenight', rizz: 'datenight', first: 'datenight',
  gym: 'workout', workout: 'workout', fitness: 'workout', yoga: 'workout',
  run: 'workout', running: 'workout', pilates: 'workout', sweat: 'workout',
  brunch: 'brunch', mimosa: 'brunch', sunday: 'brunch',
  wedding: 'wedding', bridal: 'wedding',
  festival: 'festival', concert: 'festival', coachella: 'festival',
  office: 'office', work: 'office', business: 'office', corporate: 'office',
  street: 'streetwear', streetwear: 'streetwear', hype: 'streetwear',
  sneaker: 'streetwear', sneakers: 'streetwear', drop: 'streetwear',
  minimal: 'minimalist', minimalist: 'minimalist', clean: 'minimalist',
  capsule: 'minimalist',
  vintage: 'vintage', retro: 'vintage', thrift: 'vintage', y2k: 'vintage',
  boho: 'boho', bohemian: 'boho', hippie: 'boho',
  luxury: 'luxury', rich: 'luxury', designer: 'luxury', quiet: 'luxury',
  old: 'luxury', money: 'luxury',
  formal: 'formal', gala: 'formal', black: 'formal', tie: 'formal',
  cheap: 'budget', budget: 'budget', broke: 'budget', affordable: 'budget',
  bed: 'bedroom', bedroom: 'bedroom', cozy: 'bedroom', sleep: 'bedroom',
  kitchen: 'kitchen', cooking: 'kitchen', chef: 'kitchen',
  bath: 'bathroom', bathroom: 'bathroom', shower: 'bathroom', spa: 'bathroom',
  home: 'homedecor', decor: 'homedecor', apartment: 'homedecor',
  cat: 'cats', cats: 'cats', kitten: 'cats',
  dog: 'dogs', dogs: 'dogs', puppy: 'dogs',
  wellness: 'wellness', matcha: 'wellness', skincare: 'wellness',
  self: 'wellness', glow: 'wellness',
  outfit: 'fashion', fit: 'fashion', fits: 'fashion', drip: 'fashion',
  dress: 'fashion', dresses: 'fashion', pants: 'fashion', shoes: 'fashion',
  airport: 'fashion', travel: 'fashion', beach: 'fashion', summer: 'fashion',
  winter: 'fashion', spring: 'fashion', fall: 'fashion',
  nyc: 'nyc', brooklyn: 'nyc', manhattan: 'nyc',
  la: 'la', hollywood: 'la', calabasas: 'la',
  paris: 'paris', french: 'paris',
  tokyo: 'tokyo', japan: 'tokyo', harajuku: 'tokyo',
  athleisure: 'athleisure',
  dopamine: 'maximalist', maximalist: 'maximalist',
  cottagecore: 'cottagecore', mushroom: 'cottagecore',
  scandi: 'scandi', hygge: 'scandi', neutral: 'scandi',
  industrial: 'industrial', loft: 'industrial',
  midcentury: 'midcentury',
  electronics: 'electronics', tech: 'electronics', gadget: 'electronics',
  girly: 'women', girl: 'women', girls: 'women',
  mens: 'men', guys: 'men', guy: 'men',
};

// Title-case the user's literal search so it reads as a proper catalog
// name beneath the logo. Short single tokens are kept uppercase so
// "omg" → "OMG", but longer words use Title Case.
function toCatalogName(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .map(w => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

function getRandomCatalogName(query?: string): string {
  if (query && query.trim()) {
    const q = query.toLowerCase().trim();
    const words = q.split(/\s+/).filter(w => w.length > 1);

    // Collect candidate keys from alias + direct matches
    const matched = new Set<string>();
    for (const w of words) {
      const alias = KEYWORD_ALIASES[w];
      if (alias && catalogNames[alias]) matched.add(alias);
    }
    // Direct key lookup (covers combo keys like 'fashion+la')
    for (const key of Object.keys(catalogNames)) {
      const parts = key.split('+');
      const allPartsMatched = parts.every(part =>
        words.some(w => w === part || w.includes(part) || part.includes(w))
      );
      if (allPartsMatched) matched.add(key);
    }

    if (matched.size > 0) {
      // Prefer combo keys (more specific) over single keys
      const sorted = [...matched].sort((a, b) => b.split('+').length - a.split('+').length);
      const names = catalogNames[sorted[0]];
      if (names && names.length > 0) {
        return names[Math.floor(Math.random() * names.length)];
      }
    }

    // No match - fall back to generic fashion names instead of random unrelated theme
    const fashion = catalogNames.fashion;
    return fashion[Math.floor(Math.random() * fashion.length)];
  }
  const allNames = Object.values(catalogNames).flat();
  return allNames[Math.floor(Math.random() * allNames.length)];
}

export default function Home() {
  const [view, setView] = useState<AppView>('locked');
  // First-visit splash: if the user has never been to catalog on this device,
  // show a branded splash before surfacing the gate / landing. The flag is
  // written once and never revisited so repeat visitors skip it.
  //
  // Splash timing is data-aware: we hold for at least 800ms (so the brand
  // moment doesn't flash by) and at most 2500ms (so a slow network never
  // hangs the user). In between, we dismiss as soon as the feed data lands
  // - so by the time the splash drops, the cards render with real content
  // already in cache.
  const [firstVisit, setFirstVisit] = useState(() => {
    try {
      return typeof window !== 'undefined' && !window.localStorage.getItem('catalog:visited');
    } catch { return false; }
  });
  useEffect(() => {
    if (!firstVisit) return;
    try { window.localStorage.setItem('catalog:visited', '1'); } catch { /* quota */ }

    const SPLASH_MIN_MS = 800;
    const SPLASH_MAX_MS = 2500;
    const startedAt = Date.now();
    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      setFirstVisit(false);
    };

    // Race the feed fetch + the min floor; whoever wins LAST triggers
    // dismiss (so we don't dismiss before either is ready). Then a
    // hard ceiling timer guarantees we never hang past max.
    const ceiling = window.setTimeout(dismiss, SPLASH_MAX_MS);
    let feedReady = false;
    let floorReached = false;
    const tryDismiss = () => {
      if (feedReady && floorReached) dismiss();
    };
    const floor = window.setTimeout(() => { floorReached = true; tryDismiss(); }, SPLASH_MIN_MS);
    prefetchHomeFeed()
      .then(rows => {
        // Pre-warm posters from the FRESH list while the splash is still
        // up so they're in browser cache by the time the feed renders.
        for (const ad of rows.slice(0, 6)) {
          const url = ad.thumbnail_url
            || ad.product?.image_url
            || (ad.product?.images && ad.product.images[0])
            || '';
          if (!url) continue;
          const img = new Image();
          img.decoding = 'async';
          img.src = url;
        }
      })
      .catch(() => { /* let the ceiling handle it */ })
      .finally(() => {
        const elapsed = Date.now() - startedAt;
        // If the network beat the floor, mark ready and let the floor
        // trigger dismiss; if it beat the ceiling but missed the floor,
        // still wait for the floor for the brand moment.
        feedReady = true;
        if (elapsed >= SPLASH_MIN_MS) {
          floorReached = true;
          dismiss();
        } else {
          tryDismiss();
        }
      });

    return () => {
      window.clearTimeout(ceiling);
      window.clearTimeout(floor);
    };
  }, [firstVisit]);
  const [showSplash, setShowSplash] = useState(false);
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
  const [activeFilter, setActiveFilter] = useState<'all' | 'men' | 'women'>('all');
  // Once the user manually toggles the gender chip we stop auto-syncing
  // it from the profile - otherwise their override would get clobbered
  // on the next session-restore.
  const filterUserOverride = useRef(false);
  const handleGenderFilterChange = useCallback((next: 'all' | 'men' | 'women') => {
    filterUserOverride.current = true;
    setActiveFilter(next);
    // Also update the module-level shopperGender used by every
    // product-creative query (home feed, brand strip, similar rail).
    // Without this, flipping the Shopping-for toggle to Women only
    // re-scoped the looks (small portion of the feed) - the much
    // larger creative grid kept rendering whatever the profile's
    // signup gender was set to. Mapping is straightforward:
    //   'men'   → 'male'
    //   'women' → 'female'
    //   'all'   → 'unknown' (no filter)
    setShopperGender(next === 'men' ? 'male' : next === 'women' ? 'female' : 'unknown');
  }, []);
  // Initial searchQuery comes from the URL ?q= param so a deep-linked
  // search (someone shares /catalog.shop/?q=shoes) lands in the right
  // state on first paint. Subsequent commits push history entries - see
  // the debounced syncSearchToUrl effect below - so the back button
  // walks the user through their search history.
  const initialUrlQuery = (() => {
    if (typeof window === 'undefined') return '';
    try { return new URLSearchParams(window.location.search).get('q') ?? ''; }
    catch { return ''; }
  })();
  const [searchQuery, setSearchQuery] = useState(initialUrlQuery);
  const [searchLoading, setSearchLoading] = useState(false);
  // searchTrigger is bumped on Enter / suggestion-click for an immediate
  // commit (bypassing the debounce inside ContinuousFeed). The
  // initial-mount value is non-zero when the URL already has ?q=, so
  // the feed knows to fire the search on first render rather than wait
  // for typing.
  const [searchTrigger, setSearchTrigger] = useState(initialUrlQuery ? 1 : 0);
  // Set when we're applying a popstate-driven URL change so the
  // outgoing-URL-push effect doesn't echo it back as a new history
  // entry. Without this every back-button press would push a forward
  // entry on top of the one we just came from.
  const isApplyingUrlChange = useRef(false);
  const handleSearchLoadingChange = useCallback((loading: boolean) => {
    setSearchLoading(loading);
  }, []);

  const [isLightMode, setIsLightMode] = useState(false);
  const [shuffleKey, setShuffleKey] = useState(1);
  const [layoutMode, setLayoutMode] = useState(2);
  const [catalogName, setCatalogName] = useState<string>('all');
  const [recentCatalogs, setRecentCatalogs] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('recentCatalogs') || '[]');
    } catch { return []; }
  });
  const [catalogDropdownOpen, setCatalogDropdownOpen] = useState(false);
  const catalogDropdownRef = useRef<HTMLDivElement>(null);

  const bookmarks = useBookmarks();
  const { recentProducts, pushRecent } = useRecentProducts();
  const { user, loading: authLoading, logout } = useAuth();

  // Branded splash logic. Show the splash whenever we're in the
  // 'locked' view AND either:
  //   - auth is still resolving (initial bootstrap, OAuth code exchange,
  //     or session restore from localStorage), OR
  //   - auth has resolved with a user but the auto-route effect hasn't
  //     yet flipped view to 'app' / 'waitlisted' (the waitlist-status
  //     check is async and we don't want a blank screen during it).
  // This keeps the password gate from ever flashing for users who are
  // about to be signed in, and gives every cold start a unified splash.
  const showAuthSplash = view === 'locked' && (authLoading || !!user);
  const [splashLeaving, setSplashLeaving] = useState(false);
  const [splashMounted, setSplashMounted] = useState(showAuthSplash);
  useEffect(() => {
    if (showAuthSplash) {
      setSplashMounted(true);
      setSplashLeaving(false);
      return;
    }
    if (splashMounted) {
      // Auth resolved - start the fade-out, then unmount after the
      // CSS transition completes (240 ms; matching .auth-splash
      // transition duration).
      setSplashLeaving(true);
      const t = window.setTimeout(() => setSplashMounted(false), 280);
      return () => window.clearTimeout(t);
    }
  }, [showAuthSplash, splashMounted]);

  // Track recent catalogs
  useEffect(() => {
    if (catalogName) {
      setRecentCatalogs(prev => {
        const updated = [catalogName, ...prev.filter(n => n !== catalogName)].slice(0, 5);
        localStorage.setItem('recentCatalogs', JSON.stringify(updated));
        return updated;
      });
    }
  }, [catalogName]);

  // ── URL ↔ search state sync ─────────────────────────────────────────────
  // Two-way binding between the ?q= URL param and searchQuery so each
  // committed search is its own history entry and the back button walks
  // the user through their search history.
  //
  // Push direction: debounce searchQuery by 350 ms so we don't blow the
  // history stack on every keystroke. Only push when the URL would
  // actually change, so a re-typed identical query doesn't add a
  // redundant entry. The `isApplyingUrlChange` ref guards against echo
  // when the change came from popstate.
  //
  // Pop direction: listen for popstate and read ?q=. When it differs
  // from the current state, set isApplyingUrlChange before updating
  // state so the push-effect's diff check skips the rebound.
  useEffect(() => {
    if (isApplyingUrlChange.current) {
      isApplyingUrlChange.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      const url = new URL(window.location.href);
      const current = url.searchParams.get('q') ?? '';
      const next = searchQuery;
      if (current === next) return;
      if (next) url.searchParams.set('q', next);
      else      url.searchParams.delete('q');
      window.history.pushState({ q: next }, '', url.toString());
    }, 350);
    return () => window.clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    const onPop = () => {
      try {
        const q = new URLSearchParams(window.location.search).get('q') ?? '';
        if (q !== searchQuery) {
          isApplyingUrlChange.current = true;
          setSearchQuery(q);
          // Bump trigger so the feed re-runs the search rather than
          // waiting for the user to type.
          setSearchTrigger(t => t + 1);
        }
      } catch { /* malformed URL - ignore */ }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [searchQuery]);

  // Auto-scope the feed by the shopper's profile gender so a guy lands
  // on men + unisex looks, a girl on women + unisex. Manual taps on the
  // gender chip set filterUserOverride so we never clobber the user's
  // explicit choice. Runs once per session-bound user id.
  useEffect(() => {
    if (!user || authLoading) return;
    if (filterUserOverride.current) return;
    let cancelled = false;
    getUserGender(user.id).then(g => {
      if (cancelled) return;
      // Always tell product-creative the gender so brand-strip and
      // live-ads queries scope correctly, even when the looks-level
      // filter is overridden by the user. Skip 'unknown' - that's the
      // null-state and we never want to hide the catalog from someone
      // we can't tag.
      if (g === 'male' || g === 'female') setShopperGender(g);
      if (filterUserOverride.current) return;
      if (g === 'male') setActiveFilter('men');
      else if (g === 'female') setActiveFilter('women');
      // 'unknown' leaves the catalog wide-open ('all').
    });
    return () => { cancelled = true; };
  }, [user, authLoading]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (catalogDropdownRef.current && !catalogDropdownRef.current.contains(e.target as Node)) {
        setCatalogDropdownOpen(false);
      }
    };
    if (catalogDropdownOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [catalogDropdownOpen]);

  // Auto-route on sign-in: approved users enter the app, everyone else goes to the waitlist.
  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    if (view !== 'locked') return;
    // Clean OAuth artifacts from URL once sign-in is confirmed
    if (
      window.location.hash.includes('access_token') ||
      window.location.search.includes('code=')
    ) {
      window.history.replaceState(null, '', window.location.pathname);
    }

    let cancelled = false;
    (async () => {
      if (user.role === 'admin') {
        if (!cancelled) setView('app');
        return;
      }
      // Wrap the waitlist lookup so a transient network failure (or RLS
      // regression) can't leave the user pinned on 'locked' forever - that
      // path renders an auth splash with no escape. On throw, default to the
      // waitlist view: it's the same destination an unapproved user lands
      // on, has a Retry affordance, and beats a stuck splash.
      let status: Awaited<ReturnType<typeof getWaitlistStatus>> = null;
      try {
        status = await getWaitlistStatus(user.id);
      } catch (err) {
        console.warn('[auto-route] waitlist lookup failed', err);
      }
      if (cancelled) return;
      setView(status?.approved ? 'app' : 'waitlisted');
    })();
    return () => { cancelled = true; };
  }, [user, authLoading, view]);

  // Read hash on mount for deep linking
  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash === 'app') {
      setView('app');
    } else if (hash === 'landing') {
      setView('landing');
    }
  }, []);

  // Sync hash when view changes
  useEffect(() => {
    // Don't clobber Supabase OAuth return URL - let the client parse it
    // first. Both implicit (#access_token=…) and PKCE (?code=…) flows
    // depend on the URL staying intact until supabase-js's async
    // exchange completes.
    if (window.location.hash.includes('access_token')) return;
    if (window.location.search.includes('code=')) return;

    let hash = '';
    if (view === 'app') hash = 'app';
    else if (view === 'landing') hash = 'landing';
    else if (view === 'locked') hash = '';

    if (hash) {
      window.history.replaceState(null, '', `#${hash}`);
    } else {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [view]);

  // Native shell bridge - when running inside the Flutter wrapper
  // (catalog-flutter), it dispatches CustomEvents on `window` to drive
  // the feed without needing direct React state access.
  useEffect(() => {
    const onSetCategory = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail !== 'string' || !detail) return;
      setSearchQuery('');
      setActiveFilter('all');
      setCatalogName(detail);
      setShuffleKey(k => k + 1);
      setView('app');
    };
    const onOpenBookmarks = () => { history.pushState({}, '', '/bookmarks'); setShowBookmarks(true); };
    const onOpenMyLooks = () => { history.pushState({}, '', '/my-looks'); setShowMyLooks(true); };

    window.addEventListener('catalog:set-category', onSetCategory as EventListener);
    window.addEventListener('catalog:open-bookmarks', onOpenBookmarks);
    window.addEventListener('catalog:open-my-looks', onOpenMyLooks);
    return () => {
      window.removeEventListener('catalog:set-category', onSetCategory as EventListener);
      window.removeEventListener('catalog:open-bookmarks', onOpenBookmarks);
      window.removeEventListener('catalog:open-my-looks', onOpenMyLooks);
    };
  }, []);

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
    setActiveFilter('all');
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
    setSearchTrigger(t => t + 1);
    filterUserOverride.current = true;
  }, []);

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
    setSearchTrigger(t => t + 1);
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
    setSearchTrigger(t => t + 1);
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

  // Sync handlers - push the canonical share URL whenever a modal
  // opens via in-app interaction. We use replaceState (not navigate)
  // so the SPA doesn't remount the whole feed; we just update the
  // address bar so copy-link / back-button / refresh all do the
  // right thing.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!selectedProduct) return;
    const slug = productSlug({
      id: selectedProduct.id ?? null,
      brand: selectedProduct.brand ?? null,
      name: selectedProduct.name ?? null,
    });
    if (!slug) return;
    const target = `/p/${slug}`;
    if (window.location.pathname !== target) {
      window.history.replaceState({}, '', target);
    }
  }, [selectedProduct]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!selectedLook) return;
    const slug = lookSlug({
      id: selectedLook.id ?? null,
      creator: selectedLook.creator ?? null,
      title: selectedLook.title ?? null,
    });
    if (!slug) return;
    const target = `/l/${slug}`;
    if (window.location.pathname !== target) {
      window.history.replaceState({}, '', target);
    }
  }, [selectedLook]);


  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!brandFilter) return;
    const slug = brandSlug(brandFilter);
    if (!slug) return;
    const target = `/b/${slug}`;
    if (window.location.pathname !== target) {
      window.history.replaceState({}, '', target);
    }
  }, [brandFilter]);

  // Pop URL when brand / look modals close. Product close handles
  // its own pop above (it has more state to clear).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (brandFilter) return;
    if (window.location.pathname.startsWith('/b/')) {
      window.history.replaceState({}, '', '/');
    }
  }, [brandFilter]);

  // Fresh-load handler: read the route param the Remix router gave
  // us and open the matching modal once. Runs on mount only - after
  // that, in-app navigation drives state, and the URL syncs back via
  // the effects above.
  const params = useParams();
  const slugParam = params.slug;
  const initialSlugConsumed = useRef(false);
  useEffect(() => {
    if (initialSlugConsumed.current) return;
    if (!slugParam) return;
    initialSlugConsumed.current = true;
    const path = location.pathname;
    if (path.startsWith('/p/')) {
      const idPrefix = extractIdPrefix(slugParam);
      if (!idPrefix || !supabase) return;
      // Look up the product by the 8-char UUID prefix. Sequence is
      // products → handleOpenProduct so the rest of the modal stack
      // (similar / brand rails) loads exactly like a tap-to-open.
      supabase
        .from('products')
        .select('id, name, brand, price, image_url, images, url, catalog_tags, type, is_elite')
        .ilike('id', `${idPrefix}%`)
        .limit(1)
        .then(({ data }) => {
          const row = data?.[0];
          if (!row) return;
          const product: Product = {
            id: row.id,
            name: row.name || '',
            brand: row.brand || '',
            price: row.price || '',
            url: row.url || '',
            image: row.image_url || undefined,
          };
          handleOpenProduct(product);
        });
    } else if (path.startsWith('/l/')) {
      const id = extractLookId(slugParam);
      if (id == null) return;
      const look = seedLooks.find(l => l.id === id);
      if (look) handleOpenLook(look);
    } else if (path.startsWith('/b/')) {
      // Brand slug is the kebab brand name. Reverse-lookup against
      // the products table to find the canonical brand string
      // (preserves original casing / spacing).
      if (!supabase) return;
      supabase
        .from('products')
        .select('brand')
        .not('brand', 'is', null)
        .limit(2000)
        .then(({ data }) => {
          if (!data) return;
          const target = slugParam.toLowerCase();
          const match = (data as { brand: string }[]).find(r => brandSlug(r.brand) === target);
          if (match?.brand) handleOpenBrand(match.brand);
        });
    }
    // handleOpen* are stable refs; deliberately empty deps so this
    // only runs once. The initialSlugConsumed ref guards re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugParam]);
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
      {splashMounted && (
        <div className={`auth-splash${splashLeaving ? ' leaving' : ''}`} aria-hidden="true">
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
