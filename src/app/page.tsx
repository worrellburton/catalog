'use client';

import { useState, useCallback, useMemo } from 'react';
import PasswordGate from '@/components/PasswordGate';
import FrameworkSelector from '@/components/FrameworkSelector';
import SplashScreen from '@/components/SplashScreen';
import LandingPage from '@/components/LandingPage';
import GridView from '@/components/GridView';
import LookOverlay from '@/components/LookOverlay';
import CreatorPage from '@/components/CreatorPage';
import BottomBar from '@/components/BottomBar';
import BookmarksPage from '@/components/BookmarksPage';
import InAppBrowser from '@/components/InAppBrowser';
import DeckView from '@/components/DeckView';
import CatalogLogo from '@/components/CatalogLogo';
import { Look } from '@/data/looks';
import { useBookmarks } from '@/hooks/useBookmarks';

type AppView = 'locked' | 'framework-select' | 'splash' | 'landing' | 'app' | 'deck';

export default function Home() {
  const [view, setView] = useState<AppView>('locked');
  const [showSplash, setShowSplash] = useState(false);
  const [selectedLook, setSelectedLook] = useState<Look | null>(null);
  const [creatorFilter, setCreatorFilter] = useState<string | null>(null);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [browserUrl, setBrowserUrl] = useState<{ url: string; title: string } | null>(null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'men' | 'women'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [cardWidth, setCardWidth] = useState(240);
  const [isLightMode, setIsLightMode] = useState(false);
  const [fromDeck, setFromDeck] = useState(false);

  const bookmarks = useBookmarks();

  const handlePasswordSubmit = useCallback((password: string): boolean => {
    if (password === 'deck') {
      setView('deck');
      return true;
    }
    if (password === '321') {
      setView('landing');
      return true;
    }
    if (password === '123') {
      setView('framework-select');
      return true;
    }
    return false;
  }, []);

  const basePath = '/catalogwebapp';

  const handleFrameworkSelect = useCallback((framework: 'nextjs' | 'remix' | 'java') => {
    if (framework === 'nextjs') {
      setShowSplash(true);
      setView('splash');
      setTimeout(() => {
        setView('app');
        setShowSplash(false);
      }, 2200);
    } else if (framework === 'remix') {
      window.location.href = `${basePath}/remix-app/`;
    } else if (framework === 'java') {
      window.location.href = `${basePath}/java-app/`;
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

  const sliderModes = useMemo(() => [
    { min: 120, label: 'Mosaic', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="5" height="5"/><rect x="9.5" y="2" width="5" height="5"/><rect x="17" y="2" width="5" height="5"/><rect x="2" y="9.5" width="5" height="5"/><rect x="9.5" y="9.5" width="5" height="5"/><rect x="17" y="9.5" width="5" height="5"/><rect x="2" y="17" width="5" height="5"/><rect x="9.5" y="17" width="5" height="5"/><rect x="17" y="17" width="5" height="5"/></svg> },
    { min: 200, label: 'Grid', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg> },
    { min: 300, label: 'Cards', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="8" rx="1"/><rect x="2" y="13" width="20" height="8" rx="1"/></svg> },
    { min: 400, label: 'Focus', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M6 21v-1a6 6 0 0 1 12 0v1"/></svg> },
  ], []);

  const currentMode = useMemo(() => {
    let modeIndex = 0;
    for (let i = sliderModes.length - 1; i >= 0; i--) {
      if (cardWidth >= sliderModes[i].min) { modeIndex = i; break; }
    }
    return sliderModes[modeIndex];
  }, [cardWidth, sliderModes]);

  return (
    <div className={`app-root ${isLightMode ? 'light-mode' : ''}`}>
      {view === 'locked' && (
        <PasswordGate onSubmit={handlePasswordSubmit} />
      )}

      {view === 'framework-select' && (
        <FrameworkSelector onSelect={handleFrameworkSelect} />
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
              <CatalogLogo className="logo" />
            </div>
            <div className="header-center">
              <span className="slider-view-icon" id="slider-view-icon">{currentMode.icon}</span>
              <input
                type="range"
                className="scale-slider"
                id="scale-slider"
                min="120"
                max="500"
                defaultValue={cardWidth}
                step="10"
                onChange={(e) => setCardWidth(parseInt(e.target.value))}
              />
              <span className="slider-label" id="slider-label">{currentMode.label}</span>
            </div>
            <div className="header-right">
              <button
                className="theme-toggle"
                onClick={toggleTheme}
                aria-label="Toggle theme"
              >
                {isLightMode ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                )}
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
            cardWidth={cardWidth}
            onOpenLook={handleOpenLook}
            onOpenCreator={handleOpenCreator}
            isLightMode={isLightMode}
          />

          <BottomBar
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
          />

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
