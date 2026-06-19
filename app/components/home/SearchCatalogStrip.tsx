// SearchCatalogStrip — the top-of-results intro + demographic-aware catalog
// picks (ceremony Option 1). It opens with the current catalog name shown BIG
// as a title card, then "Other catalogs you might like" as large tappable
// buttons, all riding in the feed column ABOVE the continuous results so the
// shopper scrolls straight from the picks into the feed (no blocking picker).
// Tapping a catalog runs THAT catalog; the last button keeps the current search.
//
// As the big intro scrolls away, a compact catalog-name pill rises from the
// bottom of the screen — the persistent "you're browsing Candles, tap to search
// again" affordance. Tapping it opens the search sheet (same path as tapping the
// resting search bar: focusing #bottom-search-input fires BottomBar's onFocus →
// openSearch, which raises the keyboard + opens the sheet).

import { useEffect, useRef, useState } from 'react';

interface SearchCatalogStripProps {
  query: string;
  recommendations: string[];
  /** Run a recommended catalog (no second ceremony). */
  onPick: (name: string) => void;
  /** Dismiss the strip and keep scrolling the current query's results. */
  onContinue: () => void;
}

function Spark() {
  return (
    <span className="sc-rec-spark" aria-hidden="true">
      <svg viewBox="0 0 100 100" width="15" height="15">
        <path d="M50 4 C54 30 70 46 96 50 C70 54 54 70 50 96 C46 70 30 54 4 50 C30 46 46 30 50 4 Z" fill="currentColor" />
      </svg>
    </span>
  );
}

function Chevron() {
  return (
    <svg className="sc-rec-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

// "shoes" → "Shoes", "running shoes" → "Running Shoes"
function titleCase(s: string): string {
  return s.trim().replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}

/** Open the search sheet exactly like tapping the resting search bar: focus the
 *  shared input, which fires BottomBar's onFocus → openSearch (raises keyboard +
 *  opens the sheet). Synchronous inside the tap so iOS transient activation lets
 *  the keyboard come up. Keeps Problem B self-contained (no _index.tsx wiring). */
function openSearchSheet() {
  const input = document.getElementById('bottom-search-input') as HTMLInputElement | null;
  input?.focus();
}

export default function SearchCatalogStrip({ query, recommendations, onPick, onContinue }: SearchCatalogStripProps) {
  // The intro (big catalog name) is observed; once it scrolls out of view the
  // compact name pill rises from the bottom. transform/opacity only on the pill
  // — no scroll listener, no backdrop-filter churn (IntersectionObserver fires
  // a couple of times total, not per-frame).
  const introRef = useRef<HTMLDivElement>(null);
  const [showPill, setShowPill] = useState(false);

  const title = titleCase(query) || 'Your catalog';

  useEffect(() => {
    const el = introRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => setShowPill(!entry.isIntersecting),
      // A tiny negative top margin so the pill appears just as the name clears
      // the header, not the instant a single pixel leaves the viewport.
      { rootMargin: '-72px 0px 0px 0px', threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (recommendations.length === 0) return null;

  return (
    <div className="search-catalog-strip">
      {/* Intro — the current catalog name, big, as the top of the screen. */}
      <div className="sc-intro" ref={introRef}>
        <span className="sc-intro-eyebrow">Now browsing</span>
        <h1 className="sc-intro-name">{title}</h1>
      </div>

      <div className="sc-recs">
        <div className="sc-recs-hint">Other catalogs you might like</div>
        <div className="sc-recs-list">
          {recommendations.map((name) => (
            <button key={name} type="button" className="sc-rec" onClick={() => onPick(name)}>
              <Spark />
              <span className="sc-rec-name">{name}</span>
              <Chevron />
            </button>
          ))}
          {/* The "keep my search" option — same big-button format, a touch quieter. */}
          <button type="button" className="sc-rec sc-rec--continue" onClick={onContinue}>
            <Spark />
            <span className="sc-rec-name">Continue with &ldquo;{query}&rdquo;</span>
            <Chevron />
          </button>
        </div>
      </div>

      {/* Persistent catalog-name pill — rises from the bottom once the big intro
          has scrolled away; tapping it reopens the search sheet. */}
      <button
        type="button"
        className={`sc-name-pill${showPill ? ' is-visible' : ''}`}
        onClick={openSearchSheet}
        aria-hidden={!showPill}
        tabIndex={showPill ? 0 : -1}
      >
        <Spark />
        <span className="sc-name-pill-text">{title}</span>
        <svg className="sc-name-pill-search" width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>
    </div>
  );
}
