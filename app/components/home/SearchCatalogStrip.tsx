// SearchCatalogStrip — the top-of-results intro + demographic-aware catalog
// picks (ceremony Option 1). It opens with the current catalog name shown BIG
// as a title card, then "Other catalogs you might like" as a tight cluster of
// small tappable chips, all riding in the feed column ABOVE the continuous
// results so the shopper scrolls straight from the picks into the feed (no
// blocking picker). Tapping a chip runs THAT catalog.
//
// The compact catalog-name pill is the searched feed's persistent search entry
// ("you're browsing Candles, tap to search again") — it REPLACES the white
// resting bottom bar on a searched feed (hidden via CSS). It's docked at the
// very bottom of the screen. Tapping it opens the search sheet (same path as
// tapping the resting search bar: focusing #bottom-search-input fires
// BottomBar's onFocus → openSearch, which raises the keyboard + opens the
// sheet).

interface SearchCatalogStripProps {
  query: string;
  recommendations: string[];
  /** Run a recommended catalog (no second ceremony). */
  onPick: (name: string) => void;
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

export default function SearchCatalogStrip({ query, recommendations, onPick }: SearchCatalogStripProps) {
  // The catalog-name pill is the PERSISTENT search entry on a searched feed —
  // it replaces the white resting bottom bar there (hidden via CSS on
  // `.home-feed-wrap.has-catalog-strip`). It must be visible the whole time
  // the searched feed is up, regardless of whether there's content to scroll
  // (an empty catalog like "Pizza" has nothing to scroll past), so it starts
  // visible. The big intro still scrolls away normally above the feed.
  const title = titleCase(query) || 'Your catalog';

  if (recommendations.length === 0) return null;

  return (
    <div className="search-catalog-strip">
      {/* Intro — the current catalog name, big, as the top of the screen. */}
      <div className="sc-intro">
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
            </button>
          ))}
        </div>
      </div>

      {/* Persistent catalog-name pill — the searched feed's ONLY search entry
          (the white resting bottom bar is hidden here via CSS). Docked at the
          very bottom of the screen, always visible while the searched feed is
          up; tapping it reopens the search sheet. */}
      <button
        type="button"
        className="sc-name-pill is-visible"
        onClick={openSearchSheet}
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
