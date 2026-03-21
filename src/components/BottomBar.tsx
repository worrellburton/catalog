'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { searchSuggestions } from '@/data/looks';

interface BottomBarProps {
  activeFilter: 'all' | 'men' | 'women';
  onFilterChange: (filter: 'all' | 'men' | 'women') => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  cardWidth: number;
  onCardWidthChange: (width: number) => void;
  bookmarkCount: number;
  onOpenBookmarks: () => void;
}

const sliderModes = [
  { min: 120, label: 'Mosaic', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="5" height="5"/><rect x="9.5" y="2" width="5" height="5"/><rect x="17" y="2" width="5" height="5"/><rect x="2" y="9.5" width="5" height="5"/><rect x="9.5" y="9.5" width="5" height="5"/><rect x="17" y="9.5" width="5" height="5"/><rect x="2" y="17" width="5" height="5"/><rect x="9.5" y="17" width="5" height="5"/><rect x="17" y="17" width="5" height="5"/></svg> },
  { min: 200, label: 'Grid', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg> },
  { min: 300, label: 'Cards', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="8" rx="1"/><rect x="2" y="13" width="20" height="8" rx="1"/></svg> },
  { min: 400, label: 'Focus', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M6 21v-1a6 6 0 0 1 12 0v1"/></svg> },
];

export default function BottomBar({
  activeFilter, onFilterChange, searchQuery, onSearchChange,
  cardWidth, onCardWidthChange, bookmarkCount, onOpenBookmarks
}: BottomBarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scaleTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const shuffledSuggestions = useMemo(() => {
    const shuffled = [...searchSuggestions].sort(() => Math.random() - 0.5);
    return [...shuffled, ...shuffled];
  }, []);

  const currentMode = useMemo(() => {
    let modeIndex = 0;
    for (let i = sliderModes.length - 1; i >= 0; i--) {
      if (cardWidth >= sliderModes[i].min) { modeIndex = i; break; }
    }
    return sliderModes[modeIndex];
  }, [cardWidth]);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setTimeout(() => searchInputRef.current?.focus(), 100);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    if (!searchQuery) setLocalSearch('');
    searchInputRef.current?.blur();
  }, [searchQuery]);

  const handleSearchInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocalSearch(val);
    onSearchChange(val.trim().toLowerCase());
  }, [onSearchChange]);

  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value);
    if (scaleTimeoutRef.current) clearTimeout(scaleTimeoutRef.current);
    scaleTimeoutRef.current = setTimeout(() => {
      onCardWidthChange(val);
    }, 80);
  }, [onCardWidthChange]);

  const handleFilterClick = useCallback((filter: 'men' | 'women') => {
    onFilterChange(activeFilter === filter ? 'all' : filter);
  }, [activeFilter, onFilterChange]);

  const handleSuggestionClick = useCallback((query: string) => {
    setLocalSearch(query);
    onSearchChange(query.toLowerCase());
    setSearchOpen(false);
  }, [onSearchChange]);

  return (
    <>
      {searchOpen && (
        <div className="search-backdrop visible" onClick={closeSearch} />
      )}

      <div className={`bottom-bar ${searchOpen ? 'search-open' : ''}`} id="bottom-bar">
        {searchOpen && (
          <div className="search-suggestions visible" id="search-suggestions">
            <div className="search-suggestions-track">
              {shuffledSuggestions.map((s, i) => (
                <button
                  key={i}
                  className="search-suggestion"
                  onClick={() => handleSuggestionClick(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="bottom-bar-inner">
          <div className="bottom-bar-left">
            <button
              className={`filter-chip ${activeFilter === 'women' ? 'active' : ''}`}
              onClick={() => handleFilterClick('women')}
            >
              Women
            </button>
            <button
              className={`filter-chip ${activeFilter === 'men' ? 'active' : ''}`}
              onClick={() => handleFilterClick('men')}
            >
              Men
            </button>
          </div>

          <div className="bottom-bar-center">
            <div className="scale-control">
              <span className="slider-view-icon">{currentMode.icon}</span>
              <input
                type="range"
                className="scale-slider"
                min="120"
                max="500"
                defaultValue={cardWidth}
                onChange={handleSliderChange}
              />
              <span className="slider-label">{currentMode.label}</span>
            </div>
          </div>

          <div className="bottom-bar-right">
            <button className="search-btn" onClick={openSearch} aria-label="Search">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </button>
            <button className="bookmark-toggle" onClick={onOpenBookmarks} aria-label="Bookmarks">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
              {bookmarkCount > 0 && <span className="bookmark-count">{bookmarkCount}</span>}
            </button>
          </div>
        </div>

        {searchOpen && (
          <div className="bottom-search-wrap">
            <input
              ref={searchInputRef}
              type="text"
              className="bottom-search-input"
              placeholder="Search looks, brands, creators..."
              value={localSearch}
              onChange={handleSearchInput}
              onKeyDown={(e) => { if (e.key === 'Enter') closeSearch(); }}
            />
          </div>
        )}
      </div>
    </>
  );
}
