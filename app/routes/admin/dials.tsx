/**
 * /admin/dials — global tuning knobs that affect the whole catalog
 * surface. First dial: Video → Still image ratio. Phases 2-10 will
 * fill in the actual controls + plumbing.
 */

export default function AdminDials() {
  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Dials</h1>
        <p className="admin-page-subtitle">
          Live-tuning knobs that affect everyone on Catalog. Changes
          apply across every device the moment you move a dial.
        </p>
      </div>

      <div className="admin-detail-grid" style={{ gridTemplateColumns: '1fr', maxWidth: 720 }}>
        <div className="admin-detail-card">
          <h3>Video → Still image ratio</h3>
          <p style={{ fontSize: 13, color: '#888', margin: '4px 0 16px' }}>
            How many cards in the catalog feed should play as autoplay
            video versus render as still images. 100% = all video
            (current behaviour). 0% = all stills. Anywhere in between
            mixes them deterministically per-card so the same shopper
            sees the same split on refresh.
          </p>
          <div className="admin-empty" style={{ marginTop: 0 }}>
            Slider lands in the next commit (Phase 4).
          </div>
        </div>
      </div>
    </div>
  );
}
