// SearchCatalogStrip — the top-of-results intro + demographic-aware catalog
// picks (ceremony Option 1). It opens with the current catalog name shown BIG
// as a title card, then "Other catalogs you might like" as large tappable
// buttons, all riding in the feed column ABOVE the continuous results so the
// shopper scrolls straight from the picks into the feed (no blocking picker).
// Tapping a catalog runs THAT catalog; the last button keeps the current search.

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

export default function SearchCatalogStrip({ query, recommendations, onPick, onContinue }: SearchCatalogStripProps) {
  if (recommendations.length === 0) return null;
  const title = titleCase(query) || 'Your catalog';
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
    </div>
  );
}
