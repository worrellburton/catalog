import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from '@remix-run/react';
import FilterPanel, { ActiveFilters, getEmptyFilters, hasActiveFilters } from './FilterPanel';
import PopularCatalogPills from './PopularCatalogPills';
import { getSearchSuggestions, getCreators } from '~/services/looks';

/* Desktop-only AI-style search bar.
 *
 * Bottom-anchored, centered, capped width. Replaces the older
 * "type anywhere to search" centered hint pattern with a visible
 * input that mirrors a Gemini / ChatGPT chat bar:
 *   [+]  [filters]  [ -  -  text input  -  - ]  [mic]  [send]
 *
 * Mounted in root.tsx so it works on every page. Hitting Enter (or
 * the send button) navigates back to / with ?q=<query> applied to
 * the home grid. Mobile (≤768px) uses the BottomBar pill instead;
 * this component hides itself there via CSS.
 *
 * The keyboard "type anywhere" capture is preserved - typing
 * anywhere on the page focuses the bar so the muscle memory still
 * works. Only fires when no other input has focus.
 */

const PLACEHOLDER_HINTS = [
  'Make a catalog for anything',
  'Try "omg shoes"',
  'Try "date night"',
  'Try "y2k denim"',
  'Try "quiet luxury"',
  'Try "off duty"',
];


interface Suggestion {
  text: string;
  /** Present when the suggestion is a creator — drives the avatar +
   *  routing straight to their catalog instead of a search. */
  handle?: string;
  avatar?: string;
}

interface TypeAnywhereProps {
  /** Render IN the hero's flow (a child of ShoppingForHero) instead of as the
   *  global fixed bottom bar. The in-flow copy lives in the same flex column as
   *  the sparkle + headline so it can never drift out of alignment with them on
   *  odd viewport heights — the bug the floating, vh-anchored bar had. The two
   *  copies are mutually exclusive: while the hero is at the top the inline copy
   *  shows + captures typing and the global copy hides; once the shopper scrolls
   *  into the feed they swap. Coordinated via the `catalog:hero-inline` event
   *  dispatched by _index. */
  inline?: boolean;
}

/** Is the home hero showing at the top right now (so the inline search owns the
 *  screen and the global one should step aside)? Read synchronously for the
 *  initial render so there's no first-paint flash of both bars. */
function heroAtTop(): boolean {
  if (typeof document === 'undefined') return false;
  return !!document.querySelector('.app-root.home-hero:not(.hero-scrolled)');
}

export default function TypeAnywhere({ inline = false }: TypeAnywhereProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(getEmptyFilters());
  // Tracks whether the home hero is at the top (the inline copy's domain).
  const [heroInline, setHeroInline] = useState(heroAtTop);
  useEffect(() => {
    const onHero = (e: Event) => setHeroInline(!!(e as CustomEvent).detail?.active);
    window.addEventListener('catalog:hero-inline', onHero);
    // Re-sync on mount in case the event fired before this listener attached.
    setHeroInline(heroAtTop());
    return () => window.removeEventListener('catalog:hero-inline', onHero);
  }, []);
  // Rotating placeholder. Picks a different hint every ~3s while
  // the input is empty so the bar feels alive and shoppers see a
  // wider menu of "things to type" without being told. Pauses while
  // the user is typing or has typed text (hints disappear once
  // they've started - no point distracting them).
  const [hintIndex, setHintIndex] = useState(() => Math.floor(Math.random() * PLACEHOLDER_HINTS.length));
  const rotatingHint = PLACEHOLDER_HINTS[hintIndex];

  // Type-ahead suggestion pool (loaded once) + matches for the current text.
  // Structured so creator suggestions can render an avatar and route to
  // the creator's catalog, while plain search terms run a catalog search.
  const [allSuggestions, setAllSuggestions] = useState<Suggestion[]>([]);
  useEffect(() => {
    let cancelled = false;
    Promise.all([getSearchSuggestions(), getCreators()])
      .then(([sugg, creators]) => {
        if (cancelled) return;
        const seen = new Set<string>();
        const merged: Suggestion[] = [];
        for (const s of sugg) {
          const sl = s.toLowerCase();
          if (!seen.has(sl)) { merged.push({ text: s }); seen.add(sl); }
        }
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
  const suggestionMatches = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    const seen = new Set<string>();
    const starts: Suggestion[] = [];
    const contains: Suggestion[] = [];
    for (const s of allSuggestions) {
      const sl = s.text.toLowerCase();
      if (sl === q || seen.has(sl)) continue;
      if (sl.startsWith(q)) { starts.push(s); seen.add(sl); }
      else if (sl.includes(q)) { contains.push(s); seen.add(sl); }
    }
    // Cap at 5 so the panel stays a tight, scannable list (creators +
    // terms combined) rather than an overwhelming wall of options.
    return [...starts, ...contains].slice(0, 5);
  }, [text, allSuggestions]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (text) return;
    const id = window.setInterval(() => {
      setHintIndex(i => (i + 1) % PLACEHOLDER_HINTS.length);
    }, 3000);
    return () => window.clearInterval(id);
  }, [text]);

  // Suppress on admin routes - admins are typing into form fields
  // constantly and a fixed bar would clutter the UI.
  const onAdmin = location.pathname.startsWith('/admin');
  // Suppress on /generate too - that flow owns its own input layer.
  const onGenerate = location.pathname.startsWith('/generate');
  // Suppress on /activity - the insights page is a reading surface, not a
  // search surface; the floating search bar just clutters it.
  const onActivity = location.pathname.startsWith('/activity');
  // The GLOBAL (fixed) copy steps aside while the hero is at the top — the
  // inline copy inside the hero owns the screen there. The inline copy itself
  // is never hidden by this (it IS the hero one).
  const hidden = onAdmin || onGenerate || onActivity || (!inline && heroInline);

  const submit = useCallback((q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    // Always land on /#app with ?q=<query>. _index.tsx reads the
    // param on mount and applies it via handleCreateCatalog, then
    // strips the param off the URL so it doesn't linger.
    navigate(`/?q=${encodeURIComponent(trimmed)}#app`);
    setText('');
    inputRef.current?.blur();
  }, [navigate]);

  // "Following" pill → build a catalog of the creators the user follows.
  // The home route owns that state, so we land on /#app and hand the
  // resolved handles to _index via a CustomEvent (slight delay so the
  // home view is mounted to receive it when coming from another route).
  const handleFollowingCatalog = useCallback((handles: string[]) => {
    navigate('/#app');
    inputRef.current?.blur();
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('catalog:following-catalog', { detail: { handles } }));
    }, 60);
  }, [navigate]);

  // Type-anywhere passthrough: keystrokes outside any form field
  // focus the bar so users keep the muscle memory of "just type."
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (hidden) return;
    // The inline copy only captures "type anywhere" while the hero is at the
    // top; once scrolled away the global copy takes back over. (The global copy
    // is already gated off at the top via `hidden` above.)
    if (inline && !heroInline) return;
    const mql = window.matchMedia('(max-width: 768px)');
    if (mql.matches) return;

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Single printable character - letter, digit, space, punctuation.
      if (e.key.length === 1) {
        e.preventDefault();
        inputRef.current?.focus();
        setText(t => (t + e.key).slice(0, 80));
      } else if (e.key === 'Escape') {
        if (filtersOpen) setFiltersOpen(false);
        else if (text) setText('');
        else inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hidden, filtersOpen, text, inline, heroInline]);

  // Reset on route change so a stale buffer doesn't linger across
  // page navigations.
  useEffect(() => {
    setText('');
    setFiltersOpen(false);
  }, [location.pathname]);

  const handleFilterApply = useCallback(() => {
    // Filters drive the catalog name on the home grid. Sync the
    // resulting catalog name as a query so _index.tsx can apply it.
    setFiltersOpen(false);
    // _index.tsx already owns the filter state for the home grid;
    // navigating with the current text + an open filter panel is
    // enough to land the user there. If they had typed text we ship
    // that as the query; otherwise just go home.
    if (text.trim()) submit(text);
    else navigate('/#app');
  }, [text, submit, navigate]);

  if (hidden) return null;

  return (
    <>
      {/* Dark gradient scrim that rises from the bottom while the bar is
          focused, so the catalog pills / autocomplete read against a bright
          feed instead of disappearing into it. Sits behind the bar + pills. */}
      {focused && !inline && <div className="ai-bar-scrim" aria-hidden="true" />}
      <div className={`ai-bar-wrap${inline ? ' ai-bar-wrap--inline' : ''}`} role="search" aria-label="Search catalog">
        {/* Popular-catalog cloud — springs up above the bar when it's
            focused with an empty query, and gives way the moment the
            user starts typing. onMouseDown-preventDefault inside keeps
            the input focused through the click. */}
        {focused && !text && !filtersOpen && (
          <PopularCatalogPills onPick={submit} onFollowingCatalog={handleFollowingCatalog} />
        )}
        {/* Type-ahead matches — replaces the cloud once the user types.
            onMouseDown-preventDefault keeps the input focused through a
            pick (the cloud uses the same guard). */}
        {focused && !!text.trim() && !filtersOpen && (
          <div className="ai-bar-autocomplete" onMouseDown={(e) => e.preventDefault()}>
            {suggestionMatches.map(s => (
              s.handle ? (
                // Creator suggestion — avatar + name, taps straight into
                // their catalog (/c/<slug>) rather than running a search.
                <button
                  key={`c:${s.handle}`}
                  type="button"
                  className="ai-bar-ac-item ai-bar-ac-item--creator"
                  onClick={() => {
                    setFocused(false);
                    inputRef.current?.blur();
                    // Same in-app path as a creator-chip tap: _index sets
                    // creatorFilter, which opens the catalog + syncs /c/<slug>.
                    try { window.dispatchEvent(new CustomEvent('catalog:open-creator', { detail: { handle: s.handle } })); } catch { /* no-op */ }
                  }}
                >
                  {s.avatar ? (
                    <img
                      src={s.avatar}
                      alt=""
                      style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#3f3f46,#27272a)', color: '#d4d4d8', fontSize: 11, fontWeight: 700 }}
                    >{s.text.charAt(0).toUpperCase()}</span>
                  )}
                  <span className="ai-bar-ac-text">{s.text}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Creator</span>
                </button>
              ) : (
                <button key={`t:${s.text}`} type="button" className="ai-bar-ac-item" onClick={() => submit(s.text)}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <span className="ai-bar-ac-text">{s.text}</span>
                </button>
              )
            ))}
            <button type="button" className="ai-bar-ac-item ai-bar-ac-item--run" onClick={() => submit(text)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
              </svg>
              <span className="ai-bar-ac-text">Make a catalog for “{text.trim()}”</span>
            </button>
          </div>
        )}
        <div className="ai-bar">
          <button
            type="button"
            className={`ai-bar-icon-btn ${hasActiveFilters(activeFilters) ? 'is-active' : ''}`}
            aria-label="Filters"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen(f => !f)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="10" y1="18" x2="14" y2="18"/></svg>
          </button>
          <input
            ref={inputRef}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            name="ai-bar-search"
            id="ai-bar-search"
            className="ai-bar-input"
            placeholder={text ? '' : rotatingHint}
            value={text}
            onFocus={() => setFocused(true)}
            // Delay so a pill click (which blurs the input) still lands
            // before the cloud unmounts; the pill row's onMouseDown also
            // guards focus, this is the belt-and-suspenders fallback.
            onBlur={() => window.setTimeout(() => setFocused(false), 120)}
            onChange={(e) => setText(e.target.value.slice(0, 80))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit(text);
              } else if (e.key === 'Escape') {
                if (text) setText('');
                else inputRef.current?.blur();
              }
            }}
          />
          <button
            type="button"
            className="ai-bar-send"
            aria-label="Search"
            disabled={!text.trim()}
            onClick={() => submit(text)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
          </button>
        </div>
      </div>

      {filtersOpen && (
        <FilterPanel
          activeFilters={activeFilters}
          onFiltersChange={setActiveFilters}
          onApply={handleFilterApply}
          onClose={() => setFiltersOpen(false)}
        />
      )}
    </>
  );
}
