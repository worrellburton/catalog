import { useState, useCallback } from 'react';
import { useNavigate } from '@remix-run/react';
import PasswordGate from '~/components/PasswordGate';
import SplashScreen from '~/components/SplashScreen';
import LandingPage from '~/components/LandingPage';
import GridView from '~/components/GridView';
import LookOverlay from '~/components/LookOverlay';
import CreatorPage from '~/components/CreatorPage';
import BottomBar from '~/components/BottomBar';
import BookmarksPage from '~/components/BookmarksPage';
import InAppBrowser from '~/components/InAppBrowser';
import DeckView from '~/components/DeckView';
import CatalogLogo from '~/components/CatalogLogo';
import { Look } from '~/data/looks';
import { useBookmarks } from '~/hooks/useBookmarks';
import { catalogNames } from '~/data/catalogNames';

type AppView = 'locked' | 'splash' | 'landing' | 'app' | 'deck';

function getRandomCatalogName(): string {
  const allNames = Object.values(catalogNames).flat();
  return allNames[Math.floor(Math.random() * allNames.length)];
}

export default function Home() {
  const [view, setView] = useState<AppView>('locked');
  const [showSplash, setShowSplash] = useState(false);
  const [selectedLook, setSelectedLook] = useState<Look | null>(null);
  const [creatorFilter, setCreatorFilter] = useState<string | null>(null);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [browserUrl, setBrowserUrl] = useState<{ url: string; title: string } | null>(null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'men' | 'women'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [isLightMode, setIsLightMode] = useState(false);
  const [fromDeck, setFromDeck] = useState(false);
  const [shuffleKey, setShuffleKey] = useState(1);
  const [layoutMode, setLayoutMode] = useState(() => 1 + Math.floor(Math.random() * 3));
  const [catalogName, setCatalogName] = useState(getRandomCatalogName);

  const navigate = useNavigate();
  const bookmarks = useBookmarks();

  const handlePasswordSubmit = useCallback((password: string): boolean => {
    if (password === 'awds') {
      navigate('/admin');
      return true;
    }
    if (password === 'deck') {
      setView('deck');
      return true;
    }
    if (password === '321') {
      setView('landing');
      return true;
    }
    if (password === '123') {
      setShowSplash(true);
      setView('splash');
      setTimeout(() => {
        setView('app');
        setShowSplash(false);
      }, 2200);
      return true;
    }
    return false;
  }, []);

  const handleRemix = useCallback(() => {
    setShuffleKey(k => k + 1);
    setLayoutMode(m => (m % 3) + 1);
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

  const handleBackToDeck = useCallback(() => {
    setFromDeck(false);
    setView('deck');
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

  const handleOpenBrowser = useCallback((url: string, title: string) => {
    setBrowserUrl({ url, title });
  }, []);

  const handleCloseBrowser = useCallback(() => {
    setBrowserUrl(null);
  }, []);

  const toggleTheme = useCallback(() => {
    setIsLightMode(prev => !prev);
  }, []);

  const isAppVisible = view === 'app';

  return (
    <div className={`app-root ${isLightMode ? 'light-mode' : ''}`}>
      {view === 'locked' && (
        <PasswordGate onSubmit={handlePasswordSubmit} />
      )}

      {showSplash && <SplashScreen />}

      {view === 'landing' && (
        <LandingPage onStartBrowsing={handleLandingToApp} />
      )}

      {view === 'deck' && (
        <DeckView
          onSeeApp={handleDeckToApp}
          onVisitWebsite={handleDeckToLanding}
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
              <button className="logo-btn" onClick={handleRemix} aria-label="Remix">
                <CatalogLogo className="logo" />
              </button>
              <span className="catalog-name">{catalogName}</span>
            </div>
            <div className="header-right">
              <button
                className="shuffle-btn"
                onClick={handleRemix}
                aria-label="Remix grid"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
              </button>
              <button className="bookmark-toggle" onClick={() => setShowBookmarks(true)} aria-label="Bookmarks">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                {bookmarks.totalCount > 0 && <span className="bookmark-count">{bookmarks.totalCount}</span>}
              </button>
            </div>
          </header>

          <GridView
            activeFilter={activeFilter}
            searchQuery={searchQuery}
            onOpenLook={handleOpenLook}
            onOpenCreator={handleOpenCreator}
            isLightMode={isLightMode}
            shuffleKey={shuffleKey}
            layoutMode={layoutMode}
          />

          <BottomBar
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onOpenCreators={() => setCreatorFilter('@lilywittman')}
          />

          <button className="remix-btn-fixed" onClick={handleRemix} aria-label="Remix">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          </button>

          {selectedLook && (
            <LookOverlay
              look={selectedLook}
              onClose={handleCloseLook}
              onOpenCreator={handleOpenCreator}
              onOpenBrowser={handleOpenBrowser}
              bookmarks={bookmarks}
            />
          )}

          {creatorFilter && (
            <CreatorPage
              creatorName={creatorFilter}
              onClose={handleCloseCreator}
              onOpenLook={handleOpenLook}
            />
          )}

          {showBookmarks && (
            <BookmarksPage
              bookmarks={bookmarks}
              onClose={() => setShowBookmarks(false)}
              onOpenLook={handleOpenLook}
              onOpenBrowser={handleOpenBrowser}
            />
          )}

          {browserUrl && (
            <InAppBrowser
              url={browserUrl.url}
              title={browserUrl.title}
              onClose={handleCloseBrowser}
            />
          )}
        </>
      )}
    </div>
  );
}
