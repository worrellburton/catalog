import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getVideoStillRatio,
  setVideoStillRatio,
  subscribeVideoStillRatio,
  DEFAULT_VIDEO_STILL_RATIO,
} from '~/services/dials';
import { shouldBeVideo } from '~/utils/videoStillSplit';

/**
 * /admin/dials — global tuning knobs that affect the whole catalog
 * surface. First dial: Video → Still image ratio. Phase 10 polish:
 * snap points + a live preview grid that mirrors the predicate the
 * consumer feed actually uses, so the admin knows what the result
 * will look like before they walk away from the page.
 */

const SNAP_POINTS = [0, 25, 50, 75, 100] as const;

// Stable demo grid for the preview — fixed ids so the predicate
// keeps the same cards on the same side as the admin drags.
const PREVIEW_CARD_IDS = Array.from({ length: 12 }, (_, i) => `preview-${i}`);

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
      if (inflightValue.current === v) return;
      setRatio(v);
    });
    return () => { cancelled = true; unsub(); };
  }, []);

  const persist = (next: number) => {
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      inflightValue.current = next;
      setSaving(true);
      setVideoStillRatio(next)
        .catch(err => { setError(err.message || 'Save failed'); })
        .finally(() => {
          setSaving(false);
          window.setTimeout(() => {
            if (inflightValue.current === next) inflightValue.current = null;
          }, 1500);
        });
    }, 180);
  };

  const onSlide = (next: number) => {
    setRatio(next);
    setError(null);
    persist(next);
  };

  const previewSplit = useMemo(() => {
    const videoCount = PREVIEW_CARD_IDS.filter(id => shouldBeVideo(id, ratio)).length;
    return { videoCount, stillCount: PREVIEW_CARD_IDS.length - videoCount };
  }, [ratio]);

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
            How many cards in the catalog feed play as autoplay video
            versus render as still images. 100% = all video (current
            behaviour). 0% = all stills. The split is deterministic
            per-card so the same shopper sees the same set on refresh.
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
              {/* Snap-point pills underneath the slider — one tap
                  jumps to a common value. The active pill outlines
                  itself so the current position reads at a glance. */}
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {SNAP_POINTS.map(point => (
                  <button
                    key={point}
                    type="button"
                    onClick={() => onSlide(point)}
                    style={{
                      padding: '4px 10px',
                      fontSize: 11,
                      fontVariantNumeric: 'tabular-nums',
                      borderRadius: 999,
                      border: `1px solid ${ratio === point ? '#1a1a1a' : '#e5e5e5'}`,
                      background: ratio === point ? '#1a1a1a' : '#fff',
                      color: ratio === point ? '#fff' : '#444',
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    {point}%
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: '#999' }}>
                <span>0% — all stills</span>
                <span>{saving ? 'Saving…' : 'Saved'}</span>
                <span>100% — all video</span>
              </div>
              {error && (
                <div style={{ marginTop: 8, fontSize: 12, color: '#dc2626' }}>{error}</div>
              )}

              {/* Live preview — mirrors the predicate the consumer
                  feed uses. ▶ = video card, ▮ = still card. The
                  same set of preview ids keeps cards on the same
                  side as the admin drags, matching the per-card
                  determinism in shouldBeVideo. */}
              <div style={{ marginTop: 20, padding: '12px 14px', background: '#fafafa', borderRadius: 10 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: '#666', marginBottom: 8 }}>
                  Live preview · {previewSplit.videoCount} video · {previewSplit.stillCount} still
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(6, 1fr)',
                    gap: 6,
                  }}
                >
                  {PREVIEW_CARD_IDS.map(id => {
                    const asVideo = shouldBeVideo(id, ratio);
                    return (
                      <div
                        key={id}
                        title={asVideo ? 'Plays as video' : 'Renders as still'}
                        style={{
                          aspectRatio: '3 / 4',
                          borderRadius: 6,
                          background: asVideo
                            ? 'linear-gradient(135deg, #1e293b, #0f172a)'
                            : '#e5e5e5',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: asVideo ? '#94a3b8' : '#94a3b8',
                          fontSize: 18,
                          transition: 'background 0.18s ease',
                        }}
                      >
                        {asVideo ? '▶' : '▮'}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
