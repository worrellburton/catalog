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

const KIND_META: Record<CatalogPill['kind'], { tag: string | null }> = {
  fire:     { tag: 'On fire' },
  popular:  { tag: 'Most popular' },
  featured: { tag: 'Featured' },
  catalog:  { tag: null },
};

// Monochrome SVG icon set. Every chip gets a distinct glowing glyph; plain
// catalogs are assigned one deterministically from POOL by name hash so
// the cloud reads as a varied set of icons rather than repeats.
const ICON_PATHS: Record<string, string> = {
  people:  'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  flame:   'M12 2c1.2 3 4 4.2 4 7.8A4 4 0 0 1 8 10c0-1.6.8-2.6 1.6-3.4M9.5 14.6A2.4 2.4 0 0 0 14 14c0-1.8-1.8-2.4-1.3-4.4',
  star:    'M12 2.5l2.9 6.1 6.6.7-5 4.5 1.4 6.6L12 17.6 6.1 20.9l1.4-6.6-5-4.5 6.6-.7z',
  sparkle: 'M12 3l1.9 5.4L19 10l-5.1 1.6L12 17l-1.9-5.4L5 10l5.1-1.6z',
  tag:     'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8zM7 7h.01',
  hanger:  'M12 4a2 2 0 0 0-1 3.7L3 13h18l-8-5.3A2 2 0 0 0 12 4z',
  bag:     'M6 2 4 7v13a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V7l-2-5zM4 7h16M16 11a4 4 0 0 1-8 0',
  heart:   'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z',
  bolt:    'M13 2 3 14h9l-1 8 10-12h-9z',
  sun:     'M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  compass: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM16.2 7.8l-2.1 6.4-6.4 2.1 2.1-6.4z',
  crown:   'M2 18h20M3 8l4 4 5-7 5 7 4-4-2 10H5z',
  flower:  'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2a3 3 0 0 1 0 6M12 16a3 3 0 0 1 0 6M5 12a3 3 0 0 1 6 0M13 12a3 3 0 0 1 6 0',
};
const POOL = ['tag', 'hanger', 'bag', 'heart', 'bolt', 'sun', 'compass', 'crown', 'flower'];
function iconForName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return POOL[h % POOL.length];
}
function iconForPill(kind: CatalogPill['kind'], name: string): string {
  if (kind === 'fire') return 'flame';
  if (kind === 'popular') return 'star';
  if (kind === 'featured') return 'sparkle';
  return iconForName(name);
}

function PillIcon({ name }: { name: string }) {
  return (
    <span className="catalog-pill-icon" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d={ICON_PATHS[name] ?? ICON_PATHS.tag} />
      </svg>
    </span>
  );
}

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
            className="catalog-pill"
            style={{ animationDelay: `${idx++ * 38}ms` }}
            onClick={() => onFollowingCatalog?.(followHandles)}
            title="Make a catalog of everyone you follow"
          >
            <PillIcon name="people" />
            <span className="catalog-pill-tag">Following</span>
          </button>
        )}
        {pills.map((p) => {
          const meta = KIND_META[p.kind];
          const delay = `${idx++ * 38}ms`;
          // Render each catalog as a single pill — just the name.
          // 'On fire' / 'Most popular' / 'Featured' status is conveyed
          // by the icon glyph (flame / star / sparkle); the redundant
          // text label that used to render alongside the name read as
          // a parent-child relationship ('On fire | golf') and made it
          // unclear what to tap. The tooltip preserves the full status
          // for accessibility / hover discovery.
          return (
            <button
              key={`${p.kind}-${p.name}`}
              type="button"
              className={`catalog-pill catalog-pill--${p.kind}`}
              style={{ animationDelay: delay }}
              onClick={() => onPick(p.name)}
              title={meta.tag ? `${meta.tag}: ${p.name}` : p.name}
            >
              <PillIcon name={iconForPill(p.kind, p.name)} />
              <span className="catalog-pill-name">{p.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
