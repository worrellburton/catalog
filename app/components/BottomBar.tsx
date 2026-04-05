
import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { searchSuggestions } from '~/data/looks';
import FilterPanel, { ActiveFilters, getEmptyFilters, hasActiveFilters } from './FilterPanel';

interface BottomBarProps {
  activeFilter: 'all' | 'men' | 'women';
  onFilterChange: (filter: 'all' | 'men' | 'women') => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onOpenCreators?: () => void;
}

export default function BottomBar({
  activeFilter, onFilterChange, searchQuery, onSearchChange, onOpenCreators
}: BottomBarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(getEmptyFilters());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const scrollRAF = useRef<number | null>(null);
  const scrollY = useRef(0);

  const shuffledSuggestions = useMemo(() => {
    const shuffled = [...searchSuggestions];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return [...shuffled, ...shuffled];
  }, []);

  // Auto-scroll suggestions
  useEffect(() => {
    if (!searchOpen || !trackRef.current) {
      if (scrollRAF.current) {
        cancelAnimationFrame(scrollRAF.current);
        scrollRAF.current = null;
      }
      return;
    }

    const track = trackRef.current;
    const scrollSpeed = 0.5;

    function autoScroll() {
      scrollY.current += scrollSpeed;
      const halfHeight = track.scrollHeight / 2;
      if (halfHeight > 0 && scrollY.current >= halfHeight) {
        scrollY.current -= halfHeight;
      }
      track.style.transform = `translateY(-${scrollY.current}px)`;
      scrollRAF.current = requestAnimationFrame(autoScroll);
    }

    scrollRAF.current = requestAnimationFrame(autoScroll);
    return () => {
      if (scrollRAF.current) {
        cancelAnimationFrame(scrollRAF.current);
        scrollRAF.current = null;
      }
    };
  }, [searchOpen]);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setFiltersOpen(false);
    setTimeout(() => searchInputRef.current?.focus(), 100);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    if (!searchQuery) setLocalSearch('');
    searchInputRef.current?.blur();
  }, [searchQuery]);

  const openFilters = useCallback(() => {
    setFiltersOpen(true);
    setSearchOpen(false);
  }, []);

  const closeFilters = useCallback(() => {
    setFiltersOpen(false);
  }, []);

  const handleSearchInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocalSearch(val);
    onSearchChange(val.trim().toLowerCase());
  }, [onSearchChange]);

  const handleSuggestionClick = useCallback((query: string, e: React.MouseEvent<HTMLButtonElement>) => {
    const btn = e.currentTarget;
    btn.classList.add('tapped');
    setTimeout(() => {
      setLocalSearch(query);
      onSearchChange(query.toLowerCase());
      setSearchOpen(false);
      btn.classList.remove('tapped');
    }, 600);
  }, [onSearchChange]);

  const handleFilterApply = useCallback(() => {
    // Sync gender filters
    if (activeFilters.who.includes('men') && !activeFilters.who.includes('women')) {
      onFilterChange('men');
    } else if (activeFilters.who.includes('women') && !activeFilters.who.includes('men')) {
      onFilterChange('women');
    } else {
      onFilterChange('all');
    }
    closeFilters();
  }, [activeFilters, onFilterChange, closeFilters]);

  const handleBackdropClick = useCallback(() => {
    if (searchOpen) closeSearch();
    if (filtersOpen) closeFilters();
  }, [searchOpen, filtersOpen, closeSearch, closeFilters]);

  return (
    <>
      {(searchOpen || filtersOpen) && (
        <div className="search-backdrop visible" onClick={handleBackdropClick} />
      )}

      {searchOpen && (
        <div className="search-suggestions visible" id="search-suggestions">
          <div className="search-suggestions-track" ref={trackRef}>
            {shuffledSuggestions.map((s, i) => (
              <button
                key={i}
                className="search-suggestion"
                onClick={(e) => handleSuggestionClick(s, e)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={`bottom-bar ${searchOpen ? 'search-open' : ''} ${filtersOpen ? 'filters-open' : ''}`} id="bottom-bar">
        <div className="bottom-bar-inner">
          <button className="search-btn" onClick={openSearch} aria-label="Search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </button>
          {onOpenCreators && (
            <button className="creators-btn" onClick={onOpenCreators} aria-label="Creators">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            </button>
          )}
        </div>

        {searchOpen && (
          <div className="bottom-bar-search">
            <button
              className={`filter-btn inline ${hasActiveFilters(activeFilters) ? 'has-filters' : ''}`}
              onClick={(e) => { e.stopPropagation(); filtersOpen ? closeFilters() : openFilters(); }}
              aria-label="Filters"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="10" y1="18" x2="14" y2="18"/></svg>
            </button>
            <input
              ref={searchInputRef}
              type="text"
              className="bottom-search-input"
              id="bottom-search-input"
              placeholder="Make a catalog for anything."
              value={localSearch}
              onChange={handleSearchInput}
              onKeyDown={(e) => { if (e.key === 'Enter') closeSearch(); }}
            />
          </div>
        )}

      </div>

      {filtersOpen && (
        <FilterPanel
          activeFilters={activeFilters}
          onFiltersChange={setActiveFilters}
          onApply={handleFilterApply}
          onClose={closeFilters}
        />
      )}
    </>
  );
}
