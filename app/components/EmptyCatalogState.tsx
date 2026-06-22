// EmptyCatalogState - shown when a search/filter yields zero creatives.
// Matte-black surface with the AI-diamond particle drift behind it
// (same field as the home hero). Below the headline sits a single CTA
// that lets shoppers signal demand for the catalog they searched for;
// the count is fed from Supabase realtime so it ticks up live.

import { createPortal } from 'react-dom';
// ParticleBackground is mounted once at the app root (SiteParticleHost) so
// this surface shares the same field as splash + hero + ceremony.
import CatalogDemandCTA from '~/components/CatalogDemandCTA';

interface EmptyCatalogStateProps {
  /** Display name as shown in the UI (e.g. "Y2K Streetwear"). */
  catalogName: string;
  /** When true, shows a "sourcing" message instead of the normal demand-signal
   *  copy - used when the semantic search returned a cold miss and the backfill
   *  agent is queued to fetch products for this query. */
  isSourcing?: boolean;
}

export default function EmptyCatalogState({ catalogName, isSourcing = false }: EmptyCatalogStateProps) {
  // EmptyCatalogState is `position:fixed; inset:0` and must center on the
  // VIEWPORT. It renders deep inside ContinuousFeed → .home-feed-wrap, and
  // that wrapper takes a `transform`/`filter`/`will-change` (the
  // `home-results-reveal` reveal animation) whenever a search resolves — which
  // turns it into the containing block for fixed descendants, trapping this
  // surface inside the wrap's box (pushed into the lower third with a void
  // above). Portal to document.body so it always centers on the viewport,
  // escaping any transformed ancestor. (Same fix UserMenu uses to escape
  // .app-root's transform.) The ecCardIn fade is preserved — it lives on
  // .empty-catalog-content, which moves with this subtree.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="empty-catalog">
      <div className="empty-catalog-content">
        {/* Catalog AI spark — the orbiting-tiles diamond from the home hero,
            spinning. Core diamond + four catalog tiles counter-rotating. */}
        <span className="ec-spark" aria-hidden="true">
          <svg viewBox="0 0 140 140" width="64" height="64">
            <defs>
              <linearGradient id="ec-spark-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#fff" />
                <stop offset="50%" stopColor="#cbd5e1" />
                <stop offset="100%" stopColor="#94a3b8" />
              </linearGradient>
              <radialGradient id="ec-tile-grad" cx="50%" cy="40%" r="60%">
                <stop offset="0%" stopColor="#fff" />
                <stop offset="100%" stopColor="#64748b" />
              </radialGradient>
            </defs>
            <g className="ec-spark-orbit">
              <rect className="ec-spark-tile" x="65"  y="6"   width="10" height="10" rx="2" fill="url(#ec-tile-grad)" />
              <rect className="ec-spark-tile" x="124" y="65"  width="10" height="10" rx="2" fill="url(#ec-tile-grad)" />
              <rect className="ec-spark-tile" x="65"  y="124" width="10" height="10" rx="2" fill="url(#ec-tile-grad)" />
              <rect className="ec-spark-tile" x="6"   y="65"  width="10" height="10" rx="2" fill="url(#ec-tile-grad)" />
            </g>
            <g className="ec-spark-core">
              <path
                transform="translate(20 20)"
                d="M50 4 C54 30 70 46 96 50 C70 54 54 70 50 96 C46 70 30 54 4 50 C30 46 46 30 50 4 Z"
                fill="url(#ec-spark-grad)"
              />
            </g>
          </svg>
        </span>

        {isSourcing ? (
          <>
            <h2 className="empty-catalog-headline">
              Finding <em>{catalogName}</em>
            </h2>
            <p className="empty-catalog-subhead">
              Our agents are pulling looks and products. Check back shortly.
            </p>
            <div className="ec-sourcing" aria-live="polite">
              <div className="ec-sourcing-track">
                <span className="ec-sourcing-fill" />
              </div>
              <span className="ec-sourcing-label">Sourcing products…</span>
            </div>
          </>
        ) : (
          <>
            <h2 className="empty-catalog-headline">
              Nothing in <em>{catalogName}</em> yet
            </h2>
            <p className="empty-catalog-subhead">
              Tap below if you'd shop this. We surface what people ask for.
            </p>

            <CatalogDemandCTA catalogName={catalogName} />
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
