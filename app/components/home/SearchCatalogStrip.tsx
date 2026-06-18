// SearchCatalogStrip — the demographic-aware catalog picks, shown as an in-flow
// strip ABOVE the results feed once a search resolves (ceremony Option 1). The
// shopper scrolls straight from these into the continuous results below — no
// blocking picker. Tapping a catalog runs THAT catalog; the last button is the
// "keep my search" option in the SAME button format as the catalog picks.

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

export default function SearchCatalogStrip({ query, recommendations, onPick, onContinue }: SearchCatalogStripProps) {
  if (recommendations.length === 0) return null;
  return (
    <div className="search-catalog-strip">
      <div className="sc-recs">
        <div className="sc-recs-hint">Made for you — tap one, or keep scrolling</div>
        <div className="sc-recs-list">
          {recommendations.map((name) => (
            <button key={name} type="button" className="sc-rec" onClick={() => onPick(name)}>
              <Spark />
              <span className="sc-rec-name">{name}</span>
            </button>
          ))}
          {/* The "keep my search" option — same button format as the picks. */}
          <button type="button" className="sc-rec sc-rec--continue" onClick={onContinue}>
            <Spark />
            <span className="sc-rec-name">Continue with &ldquo;{query}&rdquo;</span>
          </button>
        </div>
      </div>
    </div>
  );
}
