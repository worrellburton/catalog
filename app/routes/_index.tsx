import { useState, useCallback, useEffect, useRef } from 'react';
import PasswordGate from '~/components/PasswordGate';
import WaitlistScreen from '~/components/WaitlistScreen';
import SplashScreen from '~/components/SplashScreen';
import LandingPage from '~/components/LandingPage';
import ContinuousFeed from '~/components/ContinuousFeed';
import CreatorPage from '~/components/CreatorPage';
import BottomBar from '~/components/BottomBar';
import BookmarksPage from '~/components/BookmarksPage';
import ProductPage from '~/components/ProductPage';
import LookOverlay from '~/components/LookOverlay';
import InAppBrowser from '~/components/InAppBrowser';
import { TrailVideoHost } from '~/components/TrailVideoHost';
import { TrailRoot } from '~/components/TrailMotion';
import CatalogLogo from '~/components/CatalogLogo';
import UserMenu from '~/components/UserMenu';
import MyLooks from '~/components/MyLooks';
import { Look, Product } from '~/data/looks';
import { useBookmarks } from '~/hooks/useBookmarks';
import { useAuth } from '~/hooks/useAuth';
import { catalogNames } from '~/data/catalogNames';
import { getWaitlistStatus } from '~/services/waitlist';
import { prefetchSimilarCreatives, prefetchCreativesByBrand, type ProductAd } from '~/services/product-creative';
import { getLooks } from '~/services/looks';
import { primeTrailAssets } from '~/utils/trailPrefetch';
import { supabase } from '~/utils/supabase';

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

    // No match — fall back to generic fashion names instead of random unrelated theme
    const fashion = catalogNames.fashion;
    return fashion[Math.floor(Math.random() * fashion.length)];
  }
  const allNames = Object.values(catalogNames).flat();
  return allNames[Math.floor(Math.random() * allNames.length)];
}

export default function Home() {
  const [view, setView] = useState<AppView>('locked');
  // First-visit splash: if the user has never been to catalog on this device,
  // show a branded splash for ~2s before surfacing the gate / landing. The
  // flag is written once and never revisited so repeat visitors skip it.
  const [firstVisit, setFirstVisit] = useState(() => {
    try {
      return typeof window !== 'undefined' && !window.localStorage.getItem('catalog:visited');
    } catch { return false; }
  });
  useEffect(() => {
    if (!firstVisit) return;
    try { window.localStorage.setItem('catalog:visited', '1'); } catch { /* quota */ }
    const t = setTimeout(() => setFirstVisit(false), 1900);
    return () => clearTimeout(t);
  }, [firstVisit]);
  const [showSplash, setShowSplash] = useState(false);
  const [selectedLook, setSelectedLook] = useState<Look | null>(null); // kept for BookmarksPage/CreatorPage overlays
  const [creatorFilter, setCreatorFilter] = useState<string | null>(null);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showMyLooks, setShowMyLooks] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedCreative, setSelectedCreative] = useState<ProductAd | null>(null);
  const [selectedSimilar, setSelectedSimilar] = useState<Product[] | null>(null);
  const [similarCreatives, setSimilarCreatives] = useState<ProductAd[] | null>(null);
  const [brandCreatives, setBrandCreatives] = useState<ProductAd[] | null>(null);
  // Editorial looks pulled from looks_creative; fed into the "You might also
  // like" grid on ProductPage. Loaded once at mount and reused.
  const [liveLooks, setLiveLooks] = useState<Look[]>([]);
  const [activeFilter, setActiveFilter] = useState<'all' | 'men' | 'women'>('all');
  const [searchQuery, setSearchQuery] = useState('');

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
  const { user, loading: authLoading, logout } = useAuth();

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
    // Clean OAuth hash fragment from URL
    if (window.location.hash.includes('access_token')) {
      window.history.replaceState(null, '', window.location.pathname);
    }

    let cancelled = false;
    (async () => {
      if (user.role === 'admin') {
        if (!cancelled) setView('app');
        return;
      }
      const status = await getWaitlistStatus(user.id);
      if (cancelled) return;
      if (status?.approved) {
        setView('app');
      } else {
        setView('waitlisted');
      }
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
    // Don't clobber Supabase OAuth return hash — let the client parse it first.
    if (window.location.hash.includes('access_token')) return;

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
    setSearchQuery('');
    setActiveFilter('all');
    setCreatorFilter(null);
    setShuffleKey(k => k + 1);
    setCatalogName('all');
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
    setSelectedLook(null);
    setSelectedCreative(null);
    setSelectedProduct(product);
    setSelectedSimilar(null);
    setSimilarCreatives(null);
    if (product.brand) {
      const sim = await fetchSimilarProducts(product.brand, null, null);
      setSelectedSimilar(sim);
    }
  }, [fetchSimilarProducts]);

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
    setSelectedLook(null);
    setSelectedProduct(mapped);
    setSelectedCreative(creative);
    setSelectedSimilar(null);
    setSimilarCreatives(null);
    setBrandCreatives(null);

    // Three lookups, all eager. Each is independently primed so the user's
    // hover often resolves them before they actually tap.
    const simP = fetchSimilarProducts(
      creative.product.brand || null,
      creative.product.catalog_tags || null,
      creative.product.id || null,
    );
    const similarP = prefetchSimilarCreatives(creative.id, 18);
    const brandP = creative.product.brand
      ? prefetchCreativesByBrand(creative.product.brand, creative.product.id || null, 12)
      : Promise.resolve([] as ProductAd[]);

    // As soon as the trail rail resolves, prime asset cache for the top few
    // results so the next morph in the trail also has its frames ready.
    similarP.then(rows => {
      primeTrailAssets(rows);
      setSimilarCreatives(rows);
    }).catch(() => { /* keep rail empty rather than throw */ });

    brandP.then(rows => {
      primeTrailAssets(rows);
      setBrandCreatives(rows);
    }).catch(() => { /* keep brand strip empty rather than throw */ });

    simP.then(setSelectedSimilar).catch(() => { /* leave brand fallback empty */ });
  }, [fetchSimilarProducts]);

  // Editorial looks for the "You might also like" grid on ProductPage. One
  // fetch per session; reused across every overlay open.
  useEffect(() => {
    let cancelled = false;
    getLooks().then(rows => { if (!cancelled) setLiveLooks(rows); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleCreateCatalog = useCallback((query: string) => {
    setSelectedProduct(null);
    setSelectedLook(null);
    setSearchQuery(query);
    setCatalogName(getRandomCatalogName(query));
  }, []);

  const toggleTheme = useCallback(() => {
    setIsLightMode(prev => !prev);
  }, []);

  const isAppVisible = view === 'app';

  // Trail depth: while the product/look overlay is open, the under-layer
  // (header + grid) recedes a hair (scale 0.985, 4px blur). Subtle parallax
  // that signals "what you tapped is now the focus" without feeling theatrical.
  const overlayOpen = !!selectedProduct || !!selectedLook;

  return (
    <TrailRoot>
    <TrailVideoHost>
    <div className={`app-root ${isLightMode ? 'light-mode' : ''}${overlayOpen ? ' has-overlay' : ''}`}>
      {view === 'locked' && <PasswordGate />}
      {view === 'waitlisted' && user && (
        <WaitlistScreen user={user} onApproved={handleWaitlistApproved} />
      )}

      {showSplash && <SplashScreen />}
      {firstVisit && <SplashScreen />}

      {view === 'landing' && (
        <LandingPage onStartBrowsing={handleLandingToApp} />
      )}

      {isAppVisible && (
        <>
          <header>
            <div className="header-left">
              <button className="logo-btn" onClick={handleLogoClick} aria-label="Home">
                <CatalogLogo className="logo" />
              </button>
            </div>
            <div className="header-right">
              <button className="bookmark-toggle" onClick={() => setShowBookmarks(true)} aria-label="Bookmarks">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                {bookmarks.totalCount > 0 && <span className="bookmark-count">{bookmarks.totalCount}</span>}
              </button>
              <UserMenu
                onOpenBookmarks={() => setShowBookmarks(true)}
                onOpenMyLooks={() => setShowMyLooks(true)}
                bookmarkCount={bookmarks.totalCount}
                user={user}
                onLogout={async () => { await logout(); setView('locked'); }}
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
            onCreateCatalog={handleCreateCatalog}
            bookmarks={bookmarks}
          />

          <BottomBar
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            searchQuery={searchQuery}
            onSearchChange={(q: string) => { setSearchQuery(q); if (q.trim()) setCatalogName(getRandomCatalogName(q)); }}
            onSelectSuggestion={(q: string) => {
              setSearchQuery(q.toLowerCase());
              setCatalogName(q.replace(/\b\w/g, (c) => c.toUpperCase()));
            }}
            onOpenCreators={() => setCreatorFilter('@lilywittman')}
            catalogName={catalogName}
          />

          <button className="remix-btn-fixed" onClick={handleRemix} onContextMenu={handleRemixReset} title="Click to remix · Right-click to reset layout" aria-label="Remix">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          </button>

          {/* LookOverlay for grid look taps */}
          {selectedLook && (
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
          )}

          {creatorFilter && (
            <CreatorPage
              creatorName={creatorFilter}
              onClose={handleCloseCreator}
              onOpenLook={handleOpenLook}
              onOpenProduct={handleOpenProduct}
              onOpenBrowser={handleOpenBrowser}
              onCreateCatalog={handleCreateCatalog}
            />
          )}

          {showBookmarks && (
            <BookmarksPage
              bookmarks={bookmarks}
              onClose={() => setShowBookmarks(false)}
              onOpenLook={handleOpenLook}
              onOpenBrowser={handleOpenBrowser}
              onOpenCreator={(handle) => { setShowBookmarks(false); handleOpenCreator(handle); }}
            />
          )}

          {showMyLooks && (
            <MyLooks onClose={() => setShowMyLooks(false)} />
          )}

          {selectedProduct && (
            <ProductPage
              product={selectedProduct}
              onClose={() => { setSelectedProduct(null); setSelectedCreative(null); setSelectedSimilar(null); setSimilarCreatives(null); setBrandCreatives(null); }}
              onOpenLook={handleOpenLook}
              onOpenBrowser={handleOpenBrowser}
              onOpenProduct={handleOpenProduct}
              onOpenCreator={handleOpenCreator}
              onOpenCreative={handleOpenCreative}
              creative={
                selectedCreative?.video_url
                  ? { id: selectedCreative.id, videoUrl: selectedCreative.video_url, thumbnailUrl: selectedCreative.thumbnail_url }
                  : undefined
              }
              similarCreatives={similarCreatives ?? undefined}
              brandCreatives={brandCreatives ?? undefined}
              lookCreatives={liveLooks.slice(0, 12)}
              bookmarks={bookmarks}
            />
          )}

        </>
      )}

      {browserState && (
        <InAppBrowser
          url={browserState.url}
          title={browserState.title}
          product={browserState.product}
          isSaved={browserState.product ? bookmarks.isProductBookmarked(browserState.product) : undefined}
          onToggleSave={browserState.product ? bookmarks.toggleProductBookmark : undefined}
          onClose={() => setBrowserState(null)}
        />
      )}
    </div>
    </TrailVideoHost>
    </TrailRoot>
  );
}
