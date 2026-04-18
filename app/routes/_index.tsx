import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from '@remix-run/react';
import PasswordGate from '~/components/PasswordGate';
import SplashScreen from '~/components/SplashScreen';
import LandingPage from '~/components/LandingPage';
import ContinuousFeed from '~/components/ContinuousFeed';
import CreatorPage from '~/components/CreatorPage';
import BottomBar from '~/components/BottomBar';
import BookmarksPage from '~/components/BookmarksPage';
import DeckView from '~/components/DeckView';
import DeckViewV6 from '~/components/DeckViewV6';
import DeckViewV7 from '~/components/DeckViewV7';
import DeckViewV8 from '~/components/DeckViewV8';
import DeckViewV9 from '~/components/DeckViewV9';
import DeckViewV1 from '~/components/DeckViewV1';
import DeckSelector from '~/components/DeckSelector';
import ProductPage from '~/components/ProductPage';
import LookOverlay from '~/components/LookOverlay';
import CatalogLogo from '~/components/CatalogLogo';
import UserMenu from '~/components/UserMenu';
import MyLooks from '~/components/MyLooks';
import { Look, Product } from '~/data/looks';
import { useBookmarks } from '~/hooks/useBookmarks';
import { useAuth } from '~/hooks/useAuth';
import { catalogNames } from '~/data/catalogNames';

type AppView = 'locked' | 'splash' | 'landing' | 'app' | 'deck-selector' | 'deck';

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
  const [showSplash, setShowSplash] = useState(false);
  const [selectedLook, setSelectedLook] = useState<Look | null>(null); // kept for BookmarksPage/CreatorPage overlays
  const [creatorFilter, setCreatorFilter] = useState<string | null>(null);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showMyLooks, setShowMyLooks] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'men' | 'women'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [isLightMode, setIsLightMode] = useState(false);
  const [fromDeck, setFromDeck] = useState(false);
  const [activeDeck, setActiveDeck] = useState<'v5' | 'v6' | 'v7' | 'v8' | 'v9' | 'v1'>('v1');
  const [shuffleKey, setShuffleKey] = useState(1);
  const [layoutMode, setLayoutMode] = useState(2);
  const [catalogName, setCatalogName] = useState(getRandomCatalogName);
  const [recentCatalogs, setRecentCatalogs] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('recentCatalogs') || '[]');
    } catch { return []; }
  });
  const [catalogDropdownOpen, setCatalogDropdownOpen] = useState(false);
  const catalogDropdownRef = useRef<HTMLDivElement>(null);

  const navigate = useNavigate();
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

  // Auto-enter main catalog grid if user is authenticated (e.g. Google OAuth redirect)
  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    if (view !== 'locked') return;
    // Clean OAuth hash fragment from URL
    if (window.location.hash.includes('access_token')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    setView('app');
  }, [user, authLoading, view]);

  // Read hash on mount for deep linking
  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash === 'deck' || hash === 'decks') {
      setView('deck-selector');
    } else if (hash === 'deck/v1' || hash.startsWith('deck/v1/')) {
      setActiveDeck('v1');
      setView('deck');
    } else if (hash === 'deck/v9' || hash.startsWith('deck/v9/')) {
      setActiveDeck('v9');
      setView('deck');
    } else if (hash === 'deck/v8' || hash.startsWith('deck/v8/')) {
      setActiveDeck('v8');
      setView('deck');
    } else if (hash === 'deck/v7' || hash.startsWith('deck/v7/')) {
      setActiveDeck('v7');
      setView('deck');
    } else if (hash === 'deck/v6' || hash.startsWith('deck/v6/')) {
      setActiveDeck('v6');
      setView('deck');
    } else if (hash === 'deck/v5' || hash.startsWith('deck/v5/')) {
      setActiveDeck('v5');
      setView('deck');
    } else if (hash === 'app') {
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
    if (view === 'deck-selector') hash = 'deck';
    else if (view === 'deck') hash = `deck/${activeDeck}`;
    else if (view === 'app') hash = 'app';
    else if (view === 'landing') hash = 'landing';
    else if (view === 'locked') hash = '';

    if (hash) {
      window.history.replaceState(null, '', `#${hash}`);
    } else {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [view, activeDeck]);

  const handlePasswordSubmit = useCallback((password: string): boolean => {
    if (password === 'awds') {
      navigate('/admin');
      return true;
    }
    if (password === 'deck') {
      setView('deck-selector');
      return true;
    }
    if (password === '123') {
      setView('app');
      return true;
    }
    return false;
  }, []);

  const handleAuthSuccess = useCallback(() => {
    setShowSplash(true);
    setView('splash');
    setTimeout(() => {
      setView('app');
      setShowSplash(false);
    }, 2200);
  }, []);

  const handleRemix = useCallback(() => {
    setShuffleKey(k => k + 1);
    setLayoutMode(m => (m % 3) + 1);
    setCatalogName(getRandomCatalogName());
  }, []);

  const handleLogoClick = useCallback(() => {
    setSearchQuery('');
    setActiveFilter('all');
    setCreatorFilter(null);
    setShuffleKey(k => k + 1);
    setCatalogName(getRandomCatalogName());
  }, []);

  const handleLandingToApp = useCallback(() => {
    setShowSplash(true);
    setView('splash');
    setTimeout(() => {
      setView('app');
      setShowSplash(false);
    }, 1200);
  }, []);

  const handleDeckToApp = useCallback(() => {
    setFromDeck(true);
    setView('app');
  }, []);

  const handleDeckToLanding = useCallback(() => {
    setView('landing');
  }, []);

  const handleSelectDeck = useCallback((deckId: string) => {
    setActiveDeck(deckId as 'v5' | 'v6' | 'v7' | 'v8' | 'v9');
    setView('deck');
  }, []);

  const handleBackToDeckSelector = useCallback(() => {
    setView('deck-selector');
  }, []);

  const handleBackToDeck = useCallback(() => {
    setFromDeck(false);
    setView('deck-selector');
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

  const handleOpenBrowser = useCallback((url: string, _title: string) => {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const handleOpenProduct = useCallback((product: Product) => {
    setSelectedLook(null);
    setSelectedProduct(product);
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

  return (
    <div className={`app-root ${isLightMode ? 'light-mode' : ''}`}>
      {view === 'locked' && (
        <PasswordGate onSubmit={handlePasswordSubmit} onAuthSuccess={handleAuthSuccess} />
      )}

      {showSplash && <SplashScreen />}

      {view === 'landing' && (
        <LandingPage onStartBrowsing={handleLandingToApp} />
      )}

      {view === 'deck-selector' && (
        <DeckSelector
          onSelectDeck={handleSelectDeck}
          onBack={() => setView('locked')}
        />
      )}

      {view === 'deck' && activeDeck === 'v5' && (
        <DeckView
          onSeeApp={handleDeckToApp}
          onVisitWebsite={handleDeckToLanding}
          onBack={handleBackToDeckSelector}
          isLightMode={isLightMode}
          onToggleTheme={toggleTheme}
        />
      )}

      {view === 'deck' && activeDeck === 'v6' && (
        <DeckViewV6
          onSeeApp={handleDeckToApp}
          onVisitWebsite={handleDeckToLanding}
          onBack={handleBackToDeckSelector}
          isLightMode={isLightMode}
          onToggleTheme={toggleTheme}
        />
      )}

      {view === 'deck' && activeDeck === 'v7' && (
        <DeckViewV7
          onSeeApp={handleDeckToApp}
          onVisitWebsite={handleDeckToLanding}
          onBack={handleBackToDeckSelector}
          isLightMode={isLightMode}
          onToggleTheme={toggleTheme}
        />
      )}

      {view === 'deck' && activeDeck === 'v8' && (
        <DeckViewV8
          onSeeApp={handleDeckToApp}
          onVisitWebsite={handleDeckToLanding}
          onBack={handleBackToDeckSelector}
          isLightMode={isLightMode}
          onToggleTheme={toggleTheme}
        />
      )}

      {view === 'deck' && activeDeck === 'v1' && (
        <DeckViewV1
          onSeeApp={handleDeckToApp}
          onVisitWebsite={handleDeckToLanding}
          onBack={handleBackToDeckSelector}
          isLightMode={isLightMode}
          onToggleTheme={toggleTheme}
        />
      )}

      {view === 'deck' && activeDeck === 'v9' && (
        <DeckViewV9
          onSeeApp={handleDeckToApp}
          onVisitWebsite={handleDeckToLanding}
          onBack={handleBackToDeckSelector}
          isLightMode={isLightMode}
          onToggleTheme={toggleTheme}
        />
      )}

      {isAppVisible && (
        <>
          {fromDeck && (
            <button className="back-to-deck-btn" onClick={handleBackToDeck}>
              &larr; Back to deck
            </button>
          )}

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
                onOpenDecks={() => setView('deck-selector')}
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

          <button className="remix-btn-fixed" onClick={handleRemix} aria-label="Remix">
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
              onClose={() => setSelectedProduct(null)}
              onOpenLook={handleOpenLook}
              onOpenBrowser={handleOpenBrowser}
              onOpenProduct={handleOpenProduct}
              onOpenCreator={handleOpenCreator}
              onCreateCatalog={handleCreateCatalog}
            />
          )}

        </>
      )}
    </div>
  );
}
