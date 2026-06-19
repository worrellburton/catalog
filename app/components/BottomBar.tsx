
import { useState, useRef, useMemo, useCallback, useEffect, memo } from 'react';
import PopularCatalogPills from './PopularCatalogPills';
import BottomBarProductTray from './BottomBarProductTray';
import ParticleBackground from './ParticleBackground';
import type { ProductAd } from '~/services/product-creative';
import CatalogLogo from './CatalogLogo';
import { useAuth } from '~/hooks/useAuth';
import { useShopperBody } from '~/hooks/useShopperBody';
import { useSearchBeam } from '~/hooks/useSearchBeam';
import FilterPanel, { ActiveFilters, getEmptyFilters, hasActiveFilters } from './FilterPanel';
import { getSearchSuggestions, getCreators } from '~/services/looks';

// Filter fields that carry real search intent (men/women are the gender
// toggle, price/creator aren't search terms). A few tokens get humanized so
// the semantic search reads them naturally.
const FILTER_QUERY_FIELDS: (keyof ActiveFilters)[] = ['occasion', 'type', 'style', 'room', 'vibe', 'location'];
const FILTER_TOKEN_HUMANIZE: Record<string, string> = {
  datenight: 'date night', midcentury: 'mid-century',
};
/** Turn the chosen Build-a-Catalog filters into a search query so the feed
 *  actually searches for that catalog instead of just relabeling. */
function composeFilterQuery(f: ActiveFilters): string {
  const tokens: string[] = [];
  for (const field of FILTER_QUERY_FIELDS) tokens.push(...f[field]);
  tokens.push(...f.who.filter(w => w !== 'men' && w !== 'women')); // dogs/cats are real intent
  return tokens.map(t => FILTER_TOKEN_HUMANIZE[t] || t).join(' ').trim();
}

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
  /** Open a product creative — fills the top of the search sheet with a
   *  shoppable product grid when the keyboard is down. */
  onOpenCreative?: (ad: ProductAd) => void;
}

/** A type-ahead match: a plain search term, or a creator (carries the
 *  handle + avatar so the row shows their picture and taps into their
 *  catalog instead of running a search). */
interface SearchSuggestion {
  text: string;
  handle?: string;
  avatar?: string;
}

function BottomBar({
  activeFilter, onFilterChange, searchQuery, onSearchChange, onSelectSuggestion, onOpenCreators, catalogName, searchLoading = false, mySizeOnly = false, onMySizeChange, onOpenCreative,
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
  // Type-ahead suggestion pool (catalog/search suggestions), loaded once.
  const [allSuggestions, setAllSuggestions] = useState<SearchSuggestion[]>([]);
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
  // ══════════════════════════════════════════════════════════════
  // SEARCH BAR HORIZONTAL-CENTER — RUNTIME ANCHOR (LOAD-BEARING)
  // ══════════════════════════════════════════════════════════════
  // Three previous rounds of CSS-based fixes were beaten by something
  // in the cascade. This effect bypasses the cascade entirely by
  // setting inline `!important` styles via setProperty — inline
  // !important is the top of CSS specificity and physically cannot
  // be overridden by author rules.
  //
  // Hardening layers in order of belt-and-suspenders:
  //   1. Compute exact left + width from window.innerWidth.
  //   2. Write left/right/margin-inline/width inline with !important.
  //   3. MutationObserver: if React (or anything else) ever rewrites
  //      the bar's `style` attribute, we immediately re-pin.
  //   4. ResizeObserver on body: catches viewport/orientation changes
  //      that don't fire window.resize on iOS WebKit.
  //   5. visualViewport.resize: iOS URL-bar collapse triggers it.
  //   6. rAF on mount: runs after the first paint so the DOM is real.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let pinning = false; // guard against MO firing on our own writes
    const pin = () => {
      const el = document.getElementById('bottom-bar');
      if (!el) return;
      const vw = window.innerWidth;
      const isMobile = vw <= 640;
      const cap = isMobile ? 504 : 560;
      // Mobile gutter matches the header's 12px side padding (logo + CTA), so
      // the search bar's left/right edges line up with the wordmark and the
      // profile cluster — equal padding across all three.
      const margin = isMobile ? 24 : 48;
      const w = Math.min(cap, vw - margin);
      const left = Math.round((vw - w) / 2);
      pinning = true;
      el.style.setProperty('left', `${left}px`, 'important');
      el.style.setProperty('right', 'auto', 'important');
      el.style.setProperty('margin-inline', '0', 'important');
      el.style.setProperty('width', `${w}px`, 'important');
      // Defer release a frame so the MO doesn't pick up our own write.
      requestAnimationFrame(() => { pinning = false; });
    };

    const raf = window.requestAnimationFrame(pin);
    window.addEventListener('resize', pin);
    window.addEventListener('orientationchange', pin);
    window.visualViewport?.addEventListener('resize', pin);

    // MutationObserver — if React re-renders the element with a
    // style={} that lacks our values, the style attribute is rewritten
    // and our inline !important goes away. Re-pin immediately.
    const el = document.getElementById('bottom-bar');
    let mo: MutationObserver | null = null;
    if (el) {
      mo = new MutationObserver(() => {
        if (pinning) return;
        // Check if our anchor values are still in place.
        const sLeft = el.style.getPropertyValue('left');
        const sWidth = el.style.getPropertyValue('width');
        if (!sLeft.endsWith('px') || !sWidth.endsWith('px')) {
          pin();
        }
      });
      mo.observe(el, { attributes: true, attributeFilter: ['style'] });
    }

    // ResizeObserver on body — iOS doesn't always fire window.resize
    // when the URL bar collapses, but body height changes do.
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => pin());
      ro.observe(document.body);
    }

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', pin);
      window.removeEventListener('orientationchange', pin);
      window.visualViewport?.removeEventListener('resize', pin);
      mo?.disconnect();
      ro?.disconnect();
    };
  }, []);

  useEffect(() => {
    // Only measure the keyboard inset while the search sheet is OPEN. The
    // --ios-bottom-chrome / --vv-height vars and kbInset are consumed only in
    // .search-open layouts, yet iOS fires visualViewport 'scroll' continuously
    // as the URL bar collapses during a NORMAL feed scroll — so leaving this
    // attached re-ran apply() (CSS-var writes + style recalc) every frame
    // behind the feed. Gating on searchOpen keeps the feed scroll clean.
    if (!searchOpen) return;
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    const root = document.documentElement;
    let raf = 0;
    const apply = () => {
      raf = 0;
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
    // Coalesce to one write per frame. iOS fires visualViewport 'scroll' rapidly
    // as the URL bar collapses during a feed scroll; writing three CSS custom
    // properties + a setState off every raw event added avoidable main-thread
    // work mid-scroll. apply() runs immediately on mount for the first measure.
    const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };
    apply();
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    return () => {
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      if (raf) cancelAnimationFrame(raf);
      // Reset the keyboard-inset vars to 0 when the search sheet closes. This
      // effect only RAN while searchOpen + a keyboard was up, so --ios-bottom-
      // chrome / --vv-height held the last keyboard height. Nothing ever zeroed
      // them, so the RESTING .bottom-bar (whose `bottom` reads max(safe-area,
      // --ios-bottom-chrome) + 20px) stayed stranded ~a-keyboard's-height up
      // the screen on the search-results feed (overlapping the catalog picks).
      // Zeroing on close drops the bar back to its normal bottom dock.
      root.style.setProperty('--ios-bottom-chrome', '0px');
      root.style.setProperty('--vv-height', `${Math.round(window.innerHeight)}px`);
      setKbInset(0);
    };
  }, [searchOpen]);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setFiltersOpen(false);
    dismissingRef.current = false;
    // Raise the keyboard on open so the shopper can type immediately (founder's
    // call — reverses Samir's dca5b7c readOnly "open without keyboard" trick).
    // The pill is editable again, so tapping it focuses directly; this re-focus
    // also covers programmatic opens (e.g. the home hero search bar).
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

  // Load the suggestion pool once: curated catalog suggestions + creator
  // names, so typing a creator (e.g. "robert bu") autocompletes them too.
  useEffect(() => {
    let cancelled = false;
    Promise.all([getSearchSuggestions(), getCreators()])
      .then(([sugg, creators]) => {
        if (cancelled) return;
        // Dedupe against the curated list (case-insensitive). Creator
        // entries carry their handle + avatar so the suggestion row shows
        // their profile picture and routes straight to their catalog.
        const seen = new Set(sugg.map(s => s.toLowerCase()));
        const merged: SearchSuggestion[] = sugg.map(s => ({ text: s }));
        for (const [handle, c] of Object.entries(creators)) {
          const name = c.displayName || c.name || handle;
          const sl = name.toLowerCase();
          if (name && !seen.has(sl)) {
            merged.push({ text: name, handle, avatar: c.avatar || undefined });
            seen.add(sl);
          }
        }
        setAllSuggestions(merged);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Type-ahead matches: only things that actually match what's typed
  // (prefix hits first, then substring) — never unrelated "ideas".
  const suggestionMatches = useMemo(() => {
    const q = localSearch.trim().toLowerCase();
    if (!q) return [];
    const seen = new Set<string>();
    const starts: SearchSuggestion[] = [];
    const contains: SearchSuggestion[] = [];
    for (const s of allSuggestions) {
      const sl = s.text.toLowerCase();
      if (sl === q || seen.has(sl)) continue;
      if (sl.startsWith(q)) { starts.push(s); seen.add(sl); }
      else if (sl.includes(q)) { contains.push(s); seen.add(sl); }
    }
    return [...starts, ...contains].slice(0, 8);
  }, [localSearch, allSuggestions]);

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

  // Catalog-pill pick on the mobile search overlay (mirrors the desktop
  // search cloud): run the catalog as a search and close the sheet.
  const pickCatalog = useCallback((query: string) => {
    if (onSelectSuggestion) onSelectSuggestion(query);
    else emitSearch(query.toLowerCase());
    setSearchOpen(false);
    // Drop the keyboard so it doesn't cover the search ceremony on mobile.
    // The pills/autocomplete preventDefault on mousedown to keep focus
    // through the tap, so we must blur explicitly after the pick.
    searchInputRef.current?.blur();
  }, [onSelectSuggestion, emitSearch]);
  const pickFollowing = useCallback((handles: string[]) => {
    setSearchOpen(false);
    searchInputRef.current?.blur();
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('catalog:following-catalog', { detail: { handles } }));
    }, 60);
  }, []);
  // Featured-creator tap: close the sheet, then jump into that creator's
  // catalog via the global event _index listens for.
  const pickCreator = useCallback((handle: string) => {
    dismissingRef.current = true;
    setSearchOpen(false);
    searchInputRef.current?.blur();
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('catalog:open-creator', { detail: { handle } }));
    }, 60);
  }, []);

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
      searchInputRef.current?.blur();
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
    // Actually SEARCH the catalog the filters describe — compose a query from
    // the chosen occasion/type/style/etc. and run it through the same
    // semantic search the typed bar uses. Without this, Build only relabeled
    // the feed and never searched.
    const query = composeFilterQuery(activeFilters);
    if (query) {
      if (onSelectSuggestion) onSelectSuggestion(query);
      else onSearchChange(query);
    }
    closeFilters();
    searchInputRef.current?.blur();
  }, [activeFilters, onFilterChange, onSelectSuggestion, onSearchChange, closeFilters]);

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

      {/* Catalog wordmark pinned to the top of the search overlay (mobile).
          Sits above the masked suggestions layer so it never fades, and
          anchors the recompose when the keyboard is up. Hidden on desktop. */}
      {searchOpen && (
        <div className="bb-search-logo" aria-hidden="true">
          <CatalogLogo />
        </div>
      )}

      {searchOpen && (
        <div
          className="search-suggestions visible"
          id="search-suggestions"
          // Pin the suggestions column's bottom to the SAME keyboard inset
          // the search bar is pinned to, so the catalog pills + creator
          // avatars always sit just above the bar in lockstep with the
          // keyboard. Without this the panel kept a static bottom padding
          // while the bar rode up the keyboard, so on keyboard show/dismiss
          // the pills and the bar overlapped. Falls back to CSS when no
          // keyboard is up.
          style={kbInset > 0 ? { paddingBottom: kbInset + 60 } : undefined}
        >
          {/* Ambient WebGL particle field behind the catalog pills — same
              drift as the splash / overlays. Explicit speed so it always
              renders (ignores the site singleton's paused state). */}
          <div className="bb-search-particles" aria-hidden="true">
            <ParticleBackground speed={1} />
          </div>
          {/* Mobile search now mirrors desktop: a stack of tappable catalog
              buttons above the bar (ranked by demand) instead of the old
              auto-scrolling suggestion text. */}
          {localSearch.trim() ? (
            <div className="bb-autocomplete" onMouseDown={(e) => e.preventDefault()}>
              {/* Primary action: run exactly what they typed. */}
              <button
                className="bb-autocomplete-item bb-autocomplete-item--run"
                onClick={() => pickCatalog(localSearch.trim())}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                </svg>
                <span className="bb-autocomplete-text">Make a catalog for “{localSearch.trim()}”</span>
              </button>
              {suggestionMatches.map(s => (
                s.handle ? (
                  // Creator match — show their profile picture and tap
                  // straight into their catalog (via pickCreator) rather
                  // than running a text search.
                  <button
                    key={`c:${s.handle}`}
                    className="bb-autocomplete-item bb-autocomplete-item--creator"
                    onClick={() => pickCreator(s.handle!)}
                  >
                    {s.avatar ? (
                      <img className="bb-autocomplete-avatar" src={s.avatar} alt="" />
                    ) : (
                      <span className="bb-autocomplete-avatar bb-autocomplete-avatar--fallback" aria-hidden="true">
                        {s.text.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="bb-autocomplete-text">{s.text}</span>
                    <span className="bb-autocomplete-kind">Creator</span>
                  </button>
                ) : (
                  <button key={`t:${s.text}`} className="bb-autocomplete-item" onClick={() => pickCatalog(s.text)}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <span className="bb-autocomplete-text">{s.text}</span>
                  </button>
                )
              ))}
            </div>
          ) : (
            <div
              className="bb-pills"
              onMouseDown={(e) => e.preventDefault()}
              // The pill cloud is absolute (bottom:0), so the parent
              // .search-suggestions inline keyboard padding never reaches it.
              // Reserve clearance HERE off the same JS-measured keyboard inset
              // the search bar pins to (kbInset), overriding the CSS
              // var(--suggestions-bar-clear) which leans on --ios-bottom-chrome
              // and can stay 0 on devices where only visualViewport sees the
              // keyboard — that desync hid the pills behind the keyboard.
              style={kbInset > 0 ? { paddingBottom: kbInset + 78 } : undefined}
            >
              {/* Keyboard down → fill the empty top space with a shoppable
                  product grid (hidden while the keyboard is up — no room). */}
              {kbInset === 0 && onOpenCreative && (
                <BottomBarProductTray onOpen={onOpenCreative} />
              )}
              {/* Catalog tags pinned to the bottom (just above the bar) via
                  .bb-pills-bottom's margin-top:auto. */}
              <div className="bb-pills-bottom">
                {isAdmin && (
                  <button
                    className="bb-pills-showall"
                    onClick={() => pickCatalog('')}
                    title="Admin-only: show every available look and product without a catalog filter"
                  >
                    Show all
                  </button>
                )}
                <PopularCatalogPills onPick={pickCatalog} onFollowingCatalog={pickFollowing} />
              </div>
            </div>
          )}
        </div>
      )}

      <div
        className={`bottom-bar is-beam-${beam} ${searchOpen ? 'search-open' : ''} ${filtersOpen ? 'filters-open' : ''}`}
        id="bottom-bar"
        style={searchOpen ? {
          // Centering is margin-based in CSS now (no translateX), so the
          // drag transform is a pure Y translate — chaining translateX(-50%)
          // here would shove the pill off-axis mid-drag.
          transform: `translateY(${dragOffset}px)`,
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
            // Editable pill: tapping it focuses the field, which raises the
            // keyboard AND (via onFocus) opens the sheet, so the shopper can type
            // immediately. Reverses Samir's dca5b7c readOnly "open without
            // keyboard" trick (founder wants the keyboard up on tap).
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
