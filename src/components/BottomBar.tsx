'use client';

import { useState, useRef, useMemo, useCallback } from 'react';
import { searchSuggestions } from '@/data/looks';

interface BottomBarProps {
  activeFilter: 'all' | 'men' | 'women';
  onFilterChange: (filter: 'all' | 'men' | 'women') => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export default function BottomBar({
  activeFilter, onFilterChange, searchQuery, onSearchChange
}: BottomBarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const shuffledSuggestions = useMemo(() => {
    const shuffled = [...searchSuggestions].sort(() => Math.random() - 0.5);
    return [...shuffled, ...shuffled];
  }, []);

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

          <div className="bottom-bar-right">
            <button className="search-btn" onClick={openSearch} aria-label="Search">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
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
