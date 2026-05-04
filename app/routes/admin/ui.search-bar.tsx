// /admin/ui/search-bar - animated beam variant picker for the bottom
// search pill. Each tile renders a live preview of the bar with that
// variant active, plus a Set / Active button.
//
// Picking a variant immediately writes to localStorage (via
// useSearchBeam) and broadcasts to every tab - the consumer feed's
// BottomBar reads the same hook and re-renders with the new beam class.

import { useMemo } from 'react';
import { useSearchBeam } from '~/hooks/useSearchBeam';
import { SEARCH_BEAMS, getSearchBeam } from '~/utils/searchBeams';

export default function AdminUiSearchBar() {
  const { beam, setBeam, reset } = useSearchBeam();
  const active = useMemo(() => getSearchBeam(beam), [beam]);

  return (
    <>
      <div className="admin-ui-section-head">
        <h2>Search bar beam</h2>
        <div className="admin-ui-active">
          <span className="admin-ui-active-label">Currently set</span>
          <span className="admin-ui-active-name">{active.label}</span>
        </div>
      </div>

      <p className="admin-ui-section-blurb">
        Each tile shows a live preview of the bottom search pill with
        that variant running. Tap <strong>Set</strong> and the bar
        reskins everywhere instantly - including this very tab.
      </p>

      <div className="admin-ui-beam-grid">
        {SEARCH_BEAMS.map(v => {
          const isActive = v.id === beam;
          return (
            <div key={v.id} className={`admin-ui-beam-tile${isActive ? ' is-active' : ''}`}>
              <div className="admin-ui-beam-preview">
                {/* Reuse the real .bottom-bar styles: same class
                    family, same beam variant class. The preview
                    reads exactly like the real thing because it
                    IS the real thing, just scoped to this tile. */}
                <div className={`admin-ui-beam-mock bottom-bar is-beam-${v.id}`}>
                  <div className="admin-ui-beam-mock-inner">
                    <span className="admin-ui-beam-mock-icon" aria-hidden="true">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="4" y1="6" x2="20" y2="6"/>
                        <line x1="7" y1="12" x2="17" y2="12"/>
                        <line x1="10" y1="18" x2="14" y2="18"/>
                      </svg>
                    </span>
                    <span className="admin-ui-beam-mock-placeholder">Make a catalog for anything</span>
                  </div>
                </div>
              </div>
              <div className="admin-ui-beam-meta">
                <div className="admin-ui-beam-meta-text">
                  <span className="admin-ui-beam-label">{v.label}</span>
                  <span className="admin-ui-beam-blurb">{v.blurb}</span>
                </div>
                <button
                  type="button"
                  className={`admin-branding-set${isActive ? ' is-active' : ''}`}
                  onClick={() => setBeam(v.id)}
                  disabled={isActive}
                >
                  {isActive ? 'Active' : 'Set'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="admin-branding-footer">
        <button
          type="button"
          className="admin-branding-reset"
          onClick={reset}
          disabled={beam === 'none'}
        >
          Reset to off
        </button>
      </div>
    </>
  );
}
