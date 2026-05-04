import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useLocation } from '@remix-run/react';
import FilterPanel, { ActiveFilters, getEmptyFilters, hasActiveFilters } from './FilterPanel';

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

export default function TypeAnywhere() {
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(getEmptyFilters());
  // Rotating placeholder. Picks a different hint every ~3s while
  // the input is empty so the bar feels alive and shoppers see a
  // wider menu of "things to type" without being told. Pauses while
  // the user is typing or has typed text (hints disappear once
  // they've started - no point distracting them).
  const [hintIndex, setHintIndex] = useState(() => Math.floor(Math.random() * PLACEHOLDER_HINTS.length));
  const rotatingHint = PLACEHOLDER_HINTS[hintIndex];

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
  const hidden = onAdmin || onGenerate;

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

  // Type-anywhere passthrough: keystrokes outside any form field
  // focus the bar so users keep the muscle memory of "just type."
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (hidden) return;
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
  }, [hidden, filtersOpen, text]);

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
      <div className="ai-bar-wrap" role="search" aria-label="Search catalog">
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
            className="ai-bar-input"
            placeholder={text ? '' : rotatingHint}
            value={text}
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
