import { useState, useMemo, useCallback } from "react";
import type { MetaFunction } from "@remix-run/node";
import { looks } from "~/data/looks";
import type { Look } from "~/data/looks";
import { LookCard } from "~/components/LookCard";
import { DetailOverlay } from "~/components/DetailOverlay";

export const meta: MetaFunction = () => {
  return [
    { title: "catalog - Remix" },
    { name: "description", content: "A visual lookbook built with Remix" },
  ];
};

export default function Index() {
  const [cardWidth, setCardWidth] = useState(220);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLook, setSelectedLook] = useState<Look | null>(null);

  const filteredLooks = useMemo(() => {
    if (!searchQuery.trim()) return looks;
    const q = searchQuery.toLowerCase();
    return looks.filter(
      (look) =>
        look.title.toLowerCase().includes(q) ||
        look.description.toLowerCase().includes(q) ||
        look.creator.toLowerCase().includes(q) ||
        look.gender.toLowerCase().includes(q) ||
        look.products.some(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.brand.toLowerCase().includes(q)
        )
    );
  }, [searchQuery]);

  const handleClose = useCallback(() => setSelectedLook(null), []);

  return (
    <>
      <header className="header">
        <div className="logo">catalog</div>
        <div className="header-center">
          <span className="scale-label">Scale</span>
          <input
            type="range"
            className="scale-slider"
            min={140}
            max={400}
            value={cardWidth}
            onChange={(e) => setCardWidth(Number(e.target.value))}
          />
        </div>
        <button
          className="search-toggle"
          onClick={() => setSearchOpen((v) => !v)}
          aria-label="Toggle search"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
      </header>

      {searchOpen && (
        <div className="search-bar">
          <input
            className="search-input"
            type="text"
            placeholder="Search looks, creators, products..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
        </div>
      )}

      <div className="grid-container">
        {filteredLooks.length > 0 ? (
          <div
            className="look-grid"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(${cardWidth}px, 1fr))`,
            }}
          >
            {filteredLooks.map((look) => (
              <LookCard
                key={look.id}
                look={look}
                onClick={() => setSelectedLook(look)}
              />
            ))}
          </div>
        ) : (
          <div className="no-results">No looks found for "{searchQuery}"</div>
        )}
      </div>

      {selectedLook && (
        <DetailOverlay look={selectedLook} onClose={handleClose} />
      )}

      <div className="remix-badge">
        <span className="remix-badge-dot" />
        Built with Remix
      </div>
    </>
  );
}
