
import { useState, useRef, useMemo, useCallback, useEffect, memo } from 'react';
import { searchSuggestions } from '~/data/looks';
import { useAuth } from '~/hooks/useAuth';
import { useShopperBody } from '~/hooks/useShopperBody';
import { useSearchBeam } from '~/hooks/useSearchBeam';
import FilterPanel, { ActiveFilters, getEmptyFilters, hasActiveFilters } from './FilterPanel';

interface BottomBarProps {
  activeFilter: 'all' | 'men' | 'women';
  onFilterChange: (filter: 'all' | 'men' | 'women') => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSelectSuggestion?: (query: string) => void;
  onOpenCreators?: () => void;
  catalogName?: string;
  /** True while nl-search is resolving - shows a spinner in the input. */
  searchLoading?: boolean;
  mySizeOnly?: boolean;
  onMySizeChange?: (v: boolean) => void;
}

function BottomBar({
  activeFilter, onFilterChange, searchQuery, onSearchChange, onSelectSuggestion, onOpenCreators, catalogName, searchLoading = false, mySizeOnly = false, onMySizeChange,
}: BottomBarProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const shopperBody = useShopperBody(user?.id);
  const hasSizeData = !!shopperBody.heightCm;
  const { beam } = useSearchBeam();
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(getEmptyFilters());
  // Drag-to-close: the top-docked search sheet can be pulled UP to dismiss,
  // with a grab-handle indicator (Apple-Maps-style sheet feel). dragOffset
  // tracks the live finger delta; dragging disables the snap transition so
  // the sheet follows the finger 1:1.
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStartY = useRef<number | null>(null);
  // Mirror of the live drag offset. touchend must read the latest value, but
  // a state-closure can be stale (React batches updates across the gesture),
  // so the ref is the source of truth for the close decision.
  const dragOffsetRef = useRef(0);
  // Set true by the dismiss paths (drag, backdrop, Escape, submit) so the
  // input's onBlur doesn't fire an unintended search when the sheet is
  // closing rather than the user pressing the keyboard's Done/tick.
  const dismissingRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const scrollRAF = useRef<number | null>(null);
  // Live height of the on-screen keyboard (+ any bottom browser chrome),
  // measured from window.visualViewport. 0 when no keyboard is up. When the
  // search sheet is open and this is > 0, the bar pins its bottom edge flush
  // to the keyboard's top — the elegant fix for the classic iOS "fixed bar
  // hides behind the keyboard" problem, driven purely by the visual viewport
  // so it tracks the keyboard 1:1 regardless of hero/feed/shell context.
  const [kbInset, setKbInset] = useState(0);
  // onSearchChange fires on every keystroke - no debounce here.
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
      const inset = Math.max(offset, 0);
      root.style.setProperty('--ios-bottom-chrome', `${inset}px`);
      // Visible viewport height (full screen minus keyboard + browser
      // chrome). On iOS Safari, where interactive-widget isn't honored,
      // the search overlay binds its height to this so the suggestion
      // column ends at the keyboard's top edge instead of running behind it.
      root.style.setProperty('--vv-height', `${Math.round(vv.height)}px`);
      // The bottom chrome alone (Safari's URL toolbar / form accessory) is
      // ~44-88px; a real soft keyboard pushes this well past 120px. Treat
      // anything above that threshold as "keyboard is up" so we only pin the
      // bar to it when there genuinely is one (and never on desktop, where
      // the visual viewport doesn't shrink).
      setKbInset(inset > 120 ? inset : 0);
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
    // Doubled so the horizontal auto-scroll can wrap seamlessly: when
    // the first half scrolls off-screen we snap back to the start and
    // the second half is already mid-frame, so the loop reads as
    // continuous.
    return [...shuffled, ...shuffled];
  }, []);

  // Auto-scroll. Always vertical (translate Y) - both mobile and
  // desktop render the suggestions as an editorial vertical column
  // now. The horizontal pill row mode is gone; mobile users were
  // getting stuck on the search overlay because the vertical feed
  // peek was hidden under the row.
  useEffect(() => {
    if (!searchOpen || !trackRef.current) {
      if (scrollRAF.current) {
        cancelAnimationFrame(scrollRAF.current);
        scrollRAF.current = null;
      }
      return;
    }
    const track = trackRef.current;
    const container = track.parentElement as HTMLElement | null;
    const SPEED = 0.5;

    // On first open, position the track so items enter from the bottom
    // (near the search bar) rather than appearing at the top of the screen.
    if (scrollY.current === 0) {
      const containerH = window.visualViewport?.height ?? container?.clientHeight ?? window.innerHeight;
      const half = track.scrollHeight / 2;
      if (half > 0 && containerH > 0) {
        // translateY(-(half - containerH + 40)) aligns the end of the first
        // batch with the bottom of the container. Items scroll upward from there.
        scrollY.current = Math.max(0, half - containerH + 40);
      }
    }

    let offset = scrollY.current;
    function tick() {
      offset += SPEED;
      const half = track.scrollHeight / 2;
      if (half > 0 && offset >= half) offset -= half;
      track.style.transform = `translateY(-${offset}px)`;
      scrollY.current = offset;
      scrollRAF.current = requestAnimationFrame(tick);
    }
    scrollRAF.current = requestAnimationFrame(tick);
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
    dismissingRef.current = false;
    setTimeout(() => searchInputRef.current?.focus(), 100);
  }, []);

  const closeSearch = useCallback(() => {
    dismissingRef.current = true;
    setSearchOpen(false);
    setDragOffset(0);
    if (!searchQuery) setLocalSearch('');
    searchInputRef.current?.blur();
  }, [searchQuery]);

  // Keep the layout scrolled to the top while the search sheet is open. On
  // iOS Safari, focusing the input (originally at the bottom of the feed)
  // makes Safari scroll the field into view there; the bar then docks to the
  // TOP, but the viewport stays scrolled, pushing the docked bar off-screen
  // on the first open. Resetting scroll on every visualViewport change keeps
  // the top-docked bar visible. The body is already overflow:locked, so this
  // only undoes the keyboard's focus-scroll — there's nothing else to scroll.
  useEffect(() => {
    if (!searchOpen || typeof window === 'undefined') return;
    const reset = () => window.scrollTo(0, 0);
    reset();
    const vv = window.visualViewport;
    vv?.addEventListener('scroll', reset);
    vv?.addEventListener('resize', reset);
    const t1 = window.setTimeout(reset, 100);
    const t2 = window.setTimeout(reset, 300);
    return () => {
      vv?.removeEventListener('scroll', reset);
      vv?.removeEventListener('resize', reset);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [searchOpen]);

  // Swipe-to-dismiss on the dimmed backdrop (the area behind the suggestion
  // column), not on the bar itself. Dragging DOWN past a threshold closes the
  // sheet; an upward pull is rubber-banded. The whole top sheet (handle + pill
  // + close button) translates with the finger for feedback, while the dim and
  // the auto-scrolling suggestions stay put.
  const onSheetDragStart = useCallback((e: React.TouchEvent) => {
    dragStartY.current = e.touches[0]?.clientY ?? null;
    dragOffsetRef.current = 0;
    setDragging(true);
  }, []);
  const onSheetDragMove = useCallback((e: React.TouchEvent) => {
    if (dragStartY.current == null) return;
    const dy = (e.touches[0]?.clientY ?? dragStartY.current) - dragStartY.current;
    const offset = dy > 0 ? dy : dy * 0.25;
    dragOffsetRef.current = offset;
    setDragOffset(offset);
  }, []);
  const onSheetDragEnd = useCallback(() => {
    setDragging(false);
    const shouldClose = dragOffsetRef.current > 56;
    dragStartY.current = null;
    dragOffsetRef.current = 0;
    setDragOffset(0);
    if (shouldClose) closeSearch();
  }, [closeSearch]);

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

  // Listen for the 'catalog:close-search' event _index.tsx fires
  // when the Catalog logo is tapped. The logo handler can't reach
  // into BottomBar's local searchOpen / filtersOpen state directly,
  // so the event is the cheapest cross-component bridge.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onClose = () => {
      setSearchOpen(false);
      setFiltersOpen(false);
      setLocalSearch('');
      searchInputRef.current?.blur();
    };
    window.addEventListener('catalog:close-search', onClose);
    return () => window.removeEventListener('catalog:close-search', onClose);
  }, []);

  // Shared submit path for both the Enter keydown and the in-app
  // send button. Mobile users on iOS often miss that the keyboard's
  // "Search" key is the submit; an explicit button removes the
  // ambiguity.
  const submitSearch = useCallback(() => {
    const q = localSearch.trim();
    if (q) {
      if (onSelectSuggestion) onSelectSuggestion(q);
      else onSearchChange(q.toLowerCase());
    }
    closeSearch();
    searchInputRef.current?.blur();
  }, [localSearch, onSelectSuggestion, onSearchChange, closeSearch]);

  const handleSuggestionClick = useCallback((query: string, e: React.MouseEvent<HTMLButtonElement>) => {
    const btn = e.currentTarget;
    dismissingRef.current = true;
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
        <div
          className="search-backdrop visible"
          onClick={handleBackdropClick}
          onTouchStart={searchOpen ? onSheetDragStart : undefined}
          onTouchMove={searchOpen ? onSheetDragMove : undefined}
          onTouchEnd={searchOpen ? onSheetDragEnd : undefined}
        />
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

      <div
        className={`bottom-bar is-beam-${beam} ${searchOpen ? 'search-open' : ''} ${filtersOpen ? 'filters-open' : ''}`}
        id="bottom-bar"
        style={searchOpen ? {
          transform: `translateX(-50%) translateY(${dragOffset}px)`,
          transition: dragging ? 'none' : undefined,
          // Pin flush to the keyboard's top edge (8px breathing gap) the
          // instant a soft keyboard appears. Inline so it beats every CSS
          // position rule (hero centering, top-dock, shell) with no
          // specificity war; falls back to CSS when no keyboard is up.
          ...(kbInset > 0 ? { bottom: kbInset + 8, top: 'auto' } : null),
        } : undefined}
      >
        {searchOpen && (
          <div className="search-drag-handle" aria-hidden="true">
            <span className="search-drag-handle-bar" />
          </div>
        )}
        {/* The bottom centered control is always an input - no more
            click-to-open. Default empty state shows the placeholder, which
            doubles as a CTA inviting shoppers to coin a brand-new catalog.
            The home feed (featured creatives) is what shows when the input
            is empty, so there's no separate "all" pill to manage. */}
        <div className="bottom-bar-row">
        <div className="bottom-bar-inner search-inline">
          <button
            className={`filter-btn inline ${hasActiveFilters(activeFilters) ? 'has-filters' : ''}`}
            onMouseDown={(e) => e.preventDefault() /* keep input focus; iOS otherwise eats the first tap on blur */}
            onClick={(e) => { e.stopPropagation(); filtersOpen ? closeFilters() : openFilters(); }}
            aria-label="Filters"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="10" y1="18" x2="14" y2="18"/></svg>
          </button>
          {/* My Size moved out of the search bar and into the Filters
              sheet (FilterPanel → Personalize section). Keeps the bar
              focused on search; size is still one tap away via Filters. */}
          <input
            ref={searchInputRef}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            autoComplete="off"
            // 1Password / Bitwarden / Chrome each respect a different
            // signal - set them all so the browser doesn't pop its
            // history dropdown over our suggestion popover.
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            name="catalog-search"
            className="bottom-search-input"
            id="bottom-search-input"
            placeholder="Make a catalog for anything"
            value={localSearch}
            onChange={handleSearchInput}
            onFocus={openSearch}
            onBlur={() => {
              // The iOS keyboard's "Done"/tick blurs the field with the sheet
              // still open — treat that as "run the search". Dismiss paths set
              // dismissingRef first so closing never triggers a search.
              if (dismissingRef.current) { dismissingRef.current = false; return; }
              if (localSearch.trim()) submitSearch();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitSearch();
              } else if (e.key === 'Escape') {
                closeSearch();
                searchInputRef.current?.blur();
              }
            }}
          />
          {/* No submit/clear/close buttons in the field. Submitting is done
              via the keyboard's return key or its Done/tick (input onBlur);
              dismissing is done via the drag handle or the dimmed backdrop.
              Only the loading spinner remains while nl-search resolves. */}
          {localSearch && searchLoading && (
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
          )}
        </div>
        {/* Apple-Maps-style close button, beside the search pill (outside it). */}
        {searchOpen && (
          <button
            type="button"
            className="bottom-search-close"
            onMouseDown={(e) => e.preventDefault() /* keep focus so the tap isn't eaten by blur */}
            onClick={closeSearch}
            aria-label="Close search"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        )}
        </div>

      </div>

      {filtersOpen && (
        <FilterPanel
          activeFilters={activeFilters}
          onFiltersChange={setActiveFilters}
          onApply={handleFilterApply}
          onClose={closeFilters}
          hasSizeData={hasSizeData}
          mySizeOnly={mySizeOnly}
          onMySizeChange={onMySizeChange}
        />
      )}
    </>
  );
}

// Memoized - _index.tsx renders this on every state tick; without memo,
// every keystroke / overlay open re-rendered the whole search bar.
export default memo(BottomBar);
