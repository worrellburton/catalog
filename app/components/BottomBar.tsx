
import { useState, useRef, useMemo, useCallback, useEffect, memo } from 'react';
import { searchSuggestions } from '~/data/looks';
import { useAuth } from '~/hooks/useAuth';
import FilterPanel, { ActiveFilters, getEmptyFilters, hasActiveFilters } from './FilterPanel';

interface BottomBarProps {
  activeFilter: 'all' | 'men' | 'women';
  onFilterChange: (filter: 'all' | 'men' | 'women') => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSelectSuggestion?: (query: string) => void;
  onOpenCreators?: () => void;
  catalogName?: string;
  /** True while nl-search is resolving — shows a spinner in the input. */
  searchLoading?: boolean;
}

function BottomBar({
  activeFilter, onFilterChange, searchQuery, onSearchChange, onSelectSuggestion, onOpenCreators, catalogName, searchLoading = false,
}: BottomBarProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(getEmptyFilters());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const scrollRAF = useRef<number | null>(null);
  // onSearchChange fires on every keystroke — no debounce here.
  // The feed itself only commits once nl-search resolves, so the spinner
  // appears immediately and the grid stays frozen until results are ready.
  const emitSearch = onSearchChange;
  const emitSearchImmediate = onSearchChange;

  // Lift the bar above iOS Safari's bottom URL toolbar. The toolbar is
  // part of the layout viewport (not the visual viewport) and isn't
  // covered by safe-area-inset-bottom, so a fixed `bottom: 24px` puts the
  // bar BEHIND it. Watching window.visualViewport lets us compute the
  // toolbar's actual height at any scroll position and feed it to CSS as
  // --ios-bottom-chrome. The bar's bottom rule reads max(safe-area, that)
  // so it always clears the toolbar.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    const root = document.documentElement;
    const update = () => {
      const offset = window.innerHeight - vv.height - vv.offsetTop;
      root.style.setProperty('--ios-bottom-chrome', `${Math.max(offset, 0)}px`);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
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
    emitSearch(val.trim().toLowerCase());
  }, [emitSearch]);

  const handleSuggestionClick = useCallback((query: string, e: React.MouseEvent<HTMLButtonElement>) => {
    const btn = e.currentTarget;
    btn.classList.add('tapped');
    setTimeout(() => {
      setLocalSearch(query);
      if (onSelectSuggestion) {
        onSelectSuggestion(query);
      } else {
        emitSearch(query.toLowerCase());
      }
      setSearchOpen(false);
      btn.classList.remove('tapped');
    }, 600);
  }, [emitSearch, onSelectSuggestion]);

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
            {isAdmin && (
              <button
                className="search-suggestion"
                onClick={(e) => handleSuggestionClick('', e)}
                style={{ fontWeight: 700, opacity: 0.95 }}
                title="Admin-only: show every available look and product without a catalog filter"
              >
                Show all
              </button>
            )}
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
        {/* The bottom centered control is always an input — no more
            click-to-open. Default empty state shows the placeholder, which
            doubles as a CTA inviting shoppers to coin a brand-new catalog.
            The home feed (featured creatives) is what shows when the input
            is empty, so there's no separate "all" pill to manage. */}
        <div className="bottom-bar-inner search-inline">
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
            placeholder="Make a catalog for anything"
            value={localSearch}
            onChange={handleSearchInput}
            onFocus={openSearch}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const q = localSearch.trim();
                if (q && onSelectSuggestion) onSelectSuggestion(q);
                closeSearch();
              } else if (e.key === 'Escape') {
                closeSearch();
              }
            }}
          />
          {localSearch && (
            searchLoading ? (
              // Spinner while nl-search is resolving
              <span className="bottom-search-spinner" aria-label="Searching" aria-live="polite">
                <svg
                  width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                  style={{ animation: 'search-spin 0.7s linear infinite', display: 'block' }}
                >
                  <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
                  <path d="M12 3a9 9 0 0 1 9 9" />
                </svg>
              </span>
            ) : (
              <button
                type="button"
                className="bottom-search-clear"
                onClick={() => { setLocalSearch(''); emitSearch(''); }}
                aria-label="Clear search"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )
          )}
        </div>

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

// Memoized — _index.tsx renders this on every state tick; without memo,
// every keystroke / overlay open re-rendered the whole search bar.
export default memo(BottomBar);
