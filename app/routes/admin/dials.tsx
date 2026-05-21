import { useEffect, useRef, useState } from 'react';
import {
  getVideoStillRatio,
  setVideoStillRatio,
  subscribeVideoStillRatio,
  DEFAULT_VIDEO_STILL_RATIO,
} from '~/services/dials';

/**
 * /admin/dials — global tuning knobs that affect the whole catalog
 * surface. First dial: Video → Still image ratio.
 *
 * Phase 4: live slider that writes through to Supabase. Writes are
 * debounced (180ms) so dragging the thumb doesn't flood the network;
 * the realtime subscription also picks up changes pushed from other
 * tabs / admins moving the same dial so the slider stays in sync.
 */

export default function AdminDials() {
  const [ratio, setRatio] = useState<number>(DEFAULT_VIDEO_STILL_RATIO);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  // Latest value we've ASKED to persist — used to ignore realtime
  // echoes of our own write so the slider doesn't jitter mid-drag.
  const inflightValue = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVideoStillRatio().then(v => {
      if (cancelled) return;
      setRatio(v);
      setLoaded(true);
    });
    const unsub = subscribeVideoStillRatio(v => {
      if (cancelled) return;
      // Skip echoes of our own writes — the optimistic local value
      // is already correct, applying the realtime payload would
      // undo any further drag the user just did.
      if (inflightValue.current === v) return;
      setRatio(v);
    });
    return () => { cancelled = true; unsub(); };
  }, []);

  const onSlide = (next: number) => {
    setRatio(next);
    setError(null);
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      inflightValue.current = next;
      setSaving(true);
      setVideoStillRatio(next)
        .catch(err => { setError(err.message || 'Save failed'); })
        .finally(() => {
          setSaving(false);
          // Clear inflight gate after a short grace window so the next
          // legit realtime push from another client isn't filtered out.
          window.setTimeout(() => {
            if (inflightValue.current === next) inflightValue.current = null;
          }, 1500);
        });
    }, 180);
  };

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
          {!loaded ? (
            <div className="admin-empty" style={{ marginTop: 0 }}>Loading…</div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={ratio}
                  onChange={e => onSlide(parseInt(e.target.value, 10))}
                  style={{ flex: 1 }}
                  aria-label="Video to still image ratio percent"
                />
                <div style={{ minWidth: 56, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {ratio}%
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: '#999' }}>
                <span>0% — all stills</span>
                <span>{saving ? 'Saving…' : 'Saved'}</span>
                <span>100% — all video</span>
              </div>
              {error && (
                <div style={{ marginTop: 8, fontSize: 12, color: '#dc2626' }}>{error}</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
