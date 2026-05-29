// PopularCatalogPills — the animated catalog cloud that springs up above
// the desktop search bar when it's focused with an empty query. Pills are
// ranked by real search demand (see getPopularCatalogPills): the hottest
// catalog in the last 24h gets the 🔥 "On fire" badge, the all-time leader
// gets ⭐ "Most popular", an editor pick gets ✨, and a "Following" pill
// (when the user follows anyone) builds a catalog of who they follow.
//
// Desktop-only — hidden under 769px via CSS. Each pill staggers in with a
// springy rise so the cloud assembles itself rather than snapping in.

import { useEffect, useState } from 'react';
import { getPopularCatalogPills, type CatalogPill } from '~/services/catalogs';
import { getMyFollowing } from '~/services/follows';

interface PopularCatalogPillsProps {
  /** Run a search for the given catalog name. */
  onPick: (query: string) => void;
  /** Build a catalog of the creators the user follows. When provided AND
   *  the user follows someone, a "Following" pill is shown first. */
  onFollowingCatalog?: (handles: string[]) => void;
}

const KIND_META: Record<CatalogPill['kind'], { icon: string; tag: string | null; cls: string }> = {
  fire:     { icon: '🔥', tag: 'On fire',      cls: 'catalog-pill--fire' },
  popular:  { icon: '⭐', tag: 'Most popular',  cls: 'catalog-pill--popular' },
  featured: { icon: '✨', tag: 'Featured',      cls: 'catalog-pill--featured' },
  catalog:  { icon: '',   tag: null,            cls: '' },
};

export default function PopularCatalogPills({ onPick, onFollowingCatalog }: PopularCatalogPillsProps) {
  const [pills, setPills] = useState<CatalogPill[] | null>(null);
  const [followHandles, setFollowHandles] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    getPopularCatalogPills().then(p => { if (!cancelled) setPills(p); }).catch(() => { if (!cancelled) setPills([]); });
    if (onFollowingCatalog) {
      getMyFollowing()
        .then(h => { if (!cancelled) setFollowHandles(h); })
        .catch(() => { /* no follows / signed out */ });
    }
    return () => { cancelled = true; };
  }, [onFollowingCatalog]);

  if (!pills || pills.length === 0) return null;

  const showFollowing = !!onFollowingCatalog && followHandles.length > 0;
  // Index drives the per-pill stagger delay; account for the Following
  // pill occupying slot 0 when present.
  let idx = 0;

  return (
    <div
      className="catalog-pills"
      id="catalog-pills"
      role="listbox"
      aria-label="Popular catalogs"
      // Keep the search input focused when a pill is clicked — otherwise
      // the input blurs first and the cloud unmounts before the click.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="catalog-pills-label">Jump into a catalog</div>
      <div className="catalog-pills-row">
        {showFollowing && (
          <button
            key="__following"
            type="button"
            className="catalog-pill catalog-pill--following"
            style={{ animationDelay: `${idx++ * 38}ms` }}
            onClick={() => onFollowingCatalog?.(followHandles)}
            title="Make a catalog of everyone you follow"
          >
            <span className="catalog-pill-icon" aria-hidden="true">👥</span>
            <span className="catalog-pill-tag">Following</span>
          </button>
        )}
        {pills.map((p) => {
          const meta = KIND_META[p.kind];
          const delay = `${idx++ * 38}ms`;
          return (
            <button
              key={`${p.kind}-${p.name}`}
              type="button"
              className={`catalog-pill ${meta.cls}`}
              style={{ animationDelay: delay }}
              onClick={() => onPick(p.name)}
              title={meta.tag ? `${meta.tag}: ${p.name}` : p.name}
            >
              {meta.icon && <span className="catalog-pill-icon" aria-hidden="true">{meta.icon}</span>}
              {meta.tag && <span className="catalog-pill-tag">{meta.tag}</span>}
              <span className="catalog-pill-name">{p.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
