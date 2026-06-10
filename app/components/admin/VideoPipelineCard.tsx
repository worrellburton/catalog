import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_VIDEO_PIPELINE,
  hydrateVideoPipeline,
  saveVideoPipelineConfig,
  subscribeVideoPipeline,
  type PrewarmCacheMode,
  type VideoPipelineConfig,
  type VideoPipelineMode,
} from '~/services/video-pipeline';

/**
 * /admin/dials → "Video delivery pipeline" card.
 *
 * Switches the consumer video grid (feed, look cards, overlays, product
 * heroes — every surface that routes through pickPlaybackSource) between the
 * two independent delivery paths, and tunes the prewarm/cache knobs both
 * paths share. Changes persist to app_settings and propagate to every
 * connected client over realtime — no deploy, no refresh.
 */

const MODE_OPTIONS: { value: VideoPipelineMode; label: string; hint: string }[] = [
  { value: 'hls', label: 'HLS · adaptive', hint: 'One m3u8 ladder per clip; starts low for an instant first frame, ramps to crisp full-screen.' },
  { value: 'mp4', label: 'Progressive MP4', hint: 'The legacy path: plain MP4s with full-file prewarm into the browser cache. Instant + lag-free feed.' },
];

const CACHE_OPTIONS: { value: PrewarmCacheMode; label: string; hint: string }[] = [
  { value: 'default', label: 'Browser cache', hint: 'Normal HTTP caching — prewarmed bytes are reused on playback (recommended).' },
  { value: 'reload', label: 'Revalidate', hint: 'Prewarm always re-fetches from the server, refreshing stale cache entries.' },
  { value: 'no-store', label: 'Bypass', hint: 'Prewarm never writes the cache — connection warming only (debug).' },
];

function SliderRow({ label, hint, min, max, value, format, onChange }: {
  label: string;
  hint: string;
  min: number;
  max: number;
  value: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{label}</span>
        <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
          {format ? format(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={e => onChange(parseInt(e.target.value, 10))}
        style={{ width: '100%', marginTop: 6 }}
        aria-label={label}
      />
      <div style={{ fontSize: 11, color: '#999', lineHeight: 1.4 }}>{hint}</div>
    </div>
  );
}

export default function VideoPipelineCard() {
  const [cfg, setCfg] = useState<VideoPipelineConfig>(DEFAULT_VIDEO_PIPELINE);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Debounced partial-save shared across the sliders; toggles/pills save
  // immediately through the same path. pendingRef accumulates fields changed
  // while a previous timer is still ticking.
  const pendingRef = useRef<Partial<VideoPipelineConfig>>({});
  const timerRef = useRef<number | null>(null);
  // While a local edit is in flight, ignore service echoes so a slider being
  // dragged doesn't snap back to a previous value mid-gesture.
  const editingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    hydrateVideoPipeline().then(c => {
      if (cancelled) return;
      setCfg(c);
      setLoaded(true);
    });
    const unsub = subscribeVideoPipeline(c => {
      if (cancelled || editingRef.current) return;
      setCfg(c);
    });
    return () => { cancelled = true; unsub(); };
  }, []);

  const update = (partial: Partial<VideoPipelineConfig>) => {
    setError(null);
    setCfg(prev => ({ ...prev, ...partial }));
    pendingRef.current = { ...pendingRef.current, ...partial };
    editingRef.current = true;
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const toSave = pendingRef.current;
      pendingRef.current = {};
      setSaving(true);
      saveVideoPipelineConfig(toSave)
        .catch(err => setError(err instanceof Error ? err.message : 'Save failed'))
        .finally(() => {
          setSaving(false);
          window.setTimeout(() => { editingRef.current = false; }, 1500);
        });
    }, 180);
  };

  return (
    <div className="admin-detail-card">
      <h3>Video delivery pipeline</h3>
      <p style={{ fontSize: 13, color: '#888', margin: '4px 0 16px' }}>
        How every video grid on the consumer app (feed, look cards, overlays,
        product heroes) delivers its clips. Two independent paths: the{' '}
        <strong>HLS</strong> adaptive ladder, or the legacy{' '}
        <strong>progressive MP4</strong> path with full-file prewarm and
        browser caching. Switching applies to every device in real time;
        clips without an HLS ladder always fall back to MP4 either way.
      </p>
      {!loaded ? (
        <div className="admin-empty" style={{ marginTop: 0 }}>Loading…</div>
      ) : (
        <>
          {/* ── Pipeline switch ── */}
          <div style={{ display: 'flex', gap: 8 }}>
            {MODE_OPTIONS.map(opt => {
              const active = cfg.mode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update({ mode: opt.value })}
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

          {/* ── Prewarm master switch ── */}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #f0f0f2', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>
                Prewarm upcoming clips {cfg.prewarmEnabled ? '· On' : '· Off'}
              </span>
              <span style={{ fontSize: 11, color: '#999', lineHeight: 1.4 }}>
                {cfg.prewarmEnabled
                  ? 'Clips just below the viewport are fetched ahead so they play instantly on scroll (MP4 bytes or HLS manifest + first segments).'
                  : 'No look-ahead fetching — every clip cold-starts when it enters the viewport.'}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={cfg.prewarmEnabled}
              onClick={() => update({ prewarmEnabled: !cfg.prewarmEnabled })}
              style={{
                position: 'relative', width: 44, height: 24, borderRadius: 999, flexShrink: 0,
                border: 'none', background: cfg.prewarmEnabled ? '#16a34a' : '#cbd5e1',
                cursor: 'pointer', transition: 'background 160ms ease', padding: 0,
              }}
            >
              <span
                style={{
                  position: 'absolute', top: 3, left: cfg.prewarmEnabled ? 23 : 3,
                  width: 18, height: 18, borderRadius: '50%',
                  background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                  transition: 'left 160ms ease',
                }}
              />
            </button>
          </div>

          {/* ── Tuning knobs (greyed when prewarm is off) ── */}
          <div style={{ opacity: cfg.prewarmEnabled ? 1 : 0.45, pointerEvents: cfg.prewarmEnabled ? 'auto' : 'none' }}>
            <SliderRow
              label="Prewarm concurrency"
              hint="Max simultaneous MP4 prewarm downloads. Higher warms more cards at once but competes with the clip the user is watching."
              min={1}
              max={8}
              value={cfg.prewarmConcurrency}
              onChange={v => update({ prewarmConcurrency: v })}
            />
            <SliderRow
              label="Prewarm queue size"
              hint="Pending backlog cap. On a fast flick, the oldest queued cards are dropped so bytes go to where the user actually is."
              min={2}
              max={30}
              value={cfg.prewarmQueueCap}
              onChange={v => update({ prewarmQueueCap: v })}
            />
            <SliderRow
              label="HLS head segments"
              hint="Media segments warmed per upcoming HLS clip (lowest rung). 0 warms only the manifest + init; more segments = smoother start, more bytes. HLS mode only."
              min={0}
              max={4}
              value={cfg.hlsWarmSegments}
              format={v => (v === 0 ? 'manifest only' : String(v))}
              onChange={v => update({ hlsWarmSegments: v })}
            />

            {/* ── Cache control ── */}
            <div style={{ marginTop: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>Prewarm cache control</span>
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {CACHE_OPTIONS.map(opt => {
                  const active = cfg.cacheMode === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      title={opt.hint}
                      onClick={() => update({ cacheMode: opt.value })}
                      style={{
                        padding: '4px 10px',
                        fontSize: 11,
                        borderRadius: 999,
                        border: `1px solid ${active ? '#1a1a1a' : '#e5e5e5'}`,
                        background: active ? '#1a1a1a' : '#fff',
                        color: active ? '#fff' : '#444',
                        cursor: 'pointer',
                        fontWeight: 500,
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: '#999', marginTop: 6, lineHeight: 1.4 }}>
                {CACHE_OPTIONS.find(o => o.value === cfg.cacheMode)?.hint}
              </div>
            </div>
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
