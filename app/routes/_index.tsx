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
import DeckSelector from '~/components/DeckSelector';
import ProductPage from '~/components/ProductPage';
import LookOverlay from '~/components/LookOverlay';
import CatalogLogo from '~/components/CatalogLogo';
import UserMenu from '~/components/UserMenu';
import { Look, Product } from '~/data/looks';
import { useBookmarks } from '~/hooks/useBookmarks';
import { useAuth } from '~/hooks/useAuth';
import { catalogNames } from '~/data/catalogNames';

type AppView = 'locked' | 'splash' | 'landing' | 'app' | 'deck-selector' | 'deck';

function getRandomCatalogName(query?: string): string {
  if (query && query.trim()) {
    const q = query.toLowerCase().trim();
    // Find keys that match the search query
    const matchingKeys = Object.keys(catalogNames).filter(key =>
      key.split('+').some(part => q.includes(part) || part.includes(q))
    );
    if (matchingKeys.length > 0) {
      // Prefer combo keys (more specific) over single keys
      const sorted = matchingKeys.sort((a, b) => b.length - a.length);
      const names = catalogNames[sorted[0]];
      return names[Math.floor(Math.random() * names.length)];
    }
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
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'men' | 'women'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [isLightMode, setIsLightMode] = useState(false);
  const [fromDeck, setFromDeck] = useState(false);
  const [activeDeck, setActiveDeck] = useState<'v5' | 'v6' | 'v7'>('v7');
  const [shuffleKey, setShuffleKey] = useState(1);
  const [layoutMode, setLayoutMode] = useState(() => 1 + Math.floor(Math.random() * 3));
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
    if (!authLoading && user && view === 'locked') {
      setShowSplash(true);
      setView('splash');
      setTimeout(() => {
        setView('app');
        setShowSplash(false);
      }, 2200);
    }
  }, [user, authLoading, view]);

  // Read hash on mount for deep linking
  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash === 'deck' || hash === 'decks') {
      setView('deck-selector');
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
    setActiveDeck(deckId as 'v5' | 'v6' | 'v7');
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
            onCreateCatalog={handleCreateCatalog}
            bookmarks={bookmarks}
          />

          <BottomBar
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            searchQuery={searchQuery}
            onSearchChange={(q: string) => { setSearchQuery(q); if (q.trim()) setCatalogName(getRandomCatalogName(q)); }}
            onOpenCreators={() => setCreatorFilter('@lilywittman')}
            catalogName={catalogName}
          />

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
