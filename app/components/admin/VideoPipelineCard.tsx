import { useEffect, useRef, useState } from 'react';
import {
  hydrateVideoPipeline,
  saveVideoPipelineMode,
  subscribeVideoPipeline,
  videoPipelineMode,
  type VideoPipelineMode,
} from '~/services/video-pipeline';

/**
 * /admin/dials → "Video delivery pipeline" card.
 *
 * The ONLY remaining video setting for the consumer feed: which delivery path
 * every video grid (feed, look cards, overlays, product heroes — everything
 * through pickPlaybackSource) uses. All prewarm / cache / HLS-head tuning was
 * removed and is now hardcoded for best performance in services/video-loading.
 * Switching the mode persists to app_settings and propagates to every connected
 * client over realtime — no deploy, no refresh.
 */

const MODE_OPTIONS: { value: VideoPipelineMode; label: string; hint: string }[] = [
  { value: 'hls', label: 'HLS · adaptive', hint: 'One m3u8 ladder per clip; starts low for an instant first frame, ramps to crisp full-screen.' },
  { value: 'mp4', label: 'Progressive MP4', hint: 'The legacy path: plain MP4s with full-file prewarm into the browser cache. Instant + lag-free feed.' },
];

export default function VideoPipelineCard() {
  const [mode, setMode] = useState<VideoPipelineMode>(videoPipelineMode());
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // While a local switch is in flight, ignore service echoes so the toggle
  // doesn't flicker back to the previous value before the save round-trips.
  const editingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    hydrateVideoPipeline().then(m => {
      if (cancelled) return;
      setMode(m);
      setLoaded(true);
    });
    const unsub = subscribeVideoPipeline(m => {
      if (cancelled || editingRef.current) return;
      setMode(m);
    });
    return () => { cancelled = true; unsub(); };
  }, []);

  const choose = (next: VideoPipelineMode) => {
    if (next === mode) return;
    setError(null);
    setMode(next);
    editingRef.current = true;
    setSaving(true);
    saveVideoPipelineMode(next)
      .catch(err => setError(err instanceof Error ? err.message : 'Save failed'))
      .finally(() => {
        setSaving(false);
        window.setTimeout(() => { editingRef.current = false; }, 1500);
      });
  };

  return (
    <div className="admin-detail-card">
      <h3>Video delivery pipeline</h3>
      <p style={{ fontSize: 13, color: '#888', margin: '4px 0 16px' }}>
        How every video grid on the consumer app (feed, look cards, overlays,
        product heroes) delivers its clips. Two independent paths: the{' '}
        <strong>HLS</strong> adaptive ladder, or the legacy{' '}
        <strong>progressive MP4</strong> path with full-file prewarm and
        browser caching. Switching applies to every device in real time; clips
        without an HLS ladder always fall back to MP4 either way. All prewarm,
        cache and HLS-head tuning is fixed for best performance.
      </p>
      {!loaded ? (
        <div className="admin-empty" style={{ marginTop: 0 }}>Loading…</div>
      ) : (
        <>
          {/* ── Pipeline switch ── */}
          <div style={{ display: 'flex', gap: 8 }}>
            {MODE_OPTIONS.map(opt => {
              const active = mode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => choose(opt.value)}
                  aria-pressed={active}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: `1px solid ${active ? '#1a1a1a' : '#e5e5e5'}`,
                    background: active ? '#1a1a1a' : '#fff',
                    color: active ? '#fff' : '#444',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{opt.label}</div>
                  <div style={{ fontSize: 11, marginTop: 4, lineHeight: 1.4, color: active ? 'rgba(255,255,255,0.75)' : '#999' }}>
                    {opt.hint}
                  </div>
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8, fontSize: 11, color: '#999' }}>
            <span>{saving ? 'Saving…' : 'Saved'}</span>
          </div>

          {error && (
            <div style={{ marginTop: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 12, color: '#991b1b' }}>
              {error}
            </div>
          )}
        </>
      )}
    </div>
  );
}
