// ShoppingForHero — the new home entry. A full-viewport matte-black ask
// screen ("What are you shopping for?") with an animated mark + a search
// pill. It's not a blocking gate: the home catalog feed lives directly
// below, so a downward scroll reveals it. Submitting a query hands off to
// the parent, which plays the SearchCeremony then reveals results.

import { useState, useRef, useCallback } from 'react';

interface ShoppingForHeroProps {
  /** Fired with the trimmed query when the shopper submits. */
  onSubmit: (query: string) => void;
  /** Scroll the page to the home feed below (the down-chevron hint). */
  onRevealFeed?: () => void;
}

export default function ShoppingForHero({ onSubmit, onRevealFeed }: ShoppingForHeroProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = useCallback(() => {
    const q = value.trim();
    if (!q) { inputRef.current?.focus(); return; }
    onSubmit(q);
  }, [value, onSubmit]);

  return (
    <section className="sfh" aria-label="What are you shopping for?">
      <div className="sfh-stage">
        {/* Animated brand mark — a soft 4-point spark that breathes. */}
        <div className="sfh-spark" aria-hidden="true">
          <svg viewBox="0 0 100 100" width="56" height="56">
            <defs>
              <linearGradient id="sfh-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#fff" />
                <stop offset="50%" stopColor="#cbd5e1" />
                <stop offset="100%" stopColor="#94a3b8" />
              </linearGradient>
            </defs>
            <path d="M50 4 C54 30 70 46 96 50 C70 54 54 70 50 96 C46 70 30 54 4 50 C30 46 46 30 50 4 Z" fill="url(#sfh-grad)" />
          </svg>
        </div>

        <h1 className="sfh-title">What are you<br/>shopping for?</h1>

        <form
          className="sfh-pill"
          onSubmit={(e) => { e.preventDefault(); submit(); }}
        >
          <span className="sfh-pill-lead" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </span>
          <input
            ref={inputRef}
            className="sfh-input"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            placeholder="a linen summer wedding fit…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <button
            type="submit"
            className={`sfh-go${value.trim() ? ' is-ready' : ''}`}
            aria-label="Search"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        </form>

        <button type="button" className="sfh-scroll-hint" onClick={onRevealFeed} aria-label="Browse the catalog below">
          <span>Scroll for your catalog</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>
    </section>
  );
}
