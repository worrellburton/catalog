// /admin/splash — preview + configure the cinematic cold-open splash.
//
// Live-replays the real CinematicSplash (using the cached home-feed
// images, exactly as the consumer sees it), and exposes the two knobs
// stored in app_settings: on/off and duration.

import { useEffect, useState } from 'react';
import CinematicSplash from '~/components/CinematicSplash';
import {
  getSplashConfig, setSplashEnabled, setSplashDuration,
  DEFAULT_SPLASH_CONFIG, type SplashConfig,
} from '~/services/splash-config';
import { getCachedHomeFeed, prefetchHomeFeed } from '~/services/product-creative';

export default function AdminSplash() {
  const [config, setConfig] = useState<SplashConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [replayKey, setReplayKey] = useState(1);
  const [previewing, setPreviewing] = useState(false);
  const [feedCount, setFeedCount] = useState<number | null>(null);

  useEffect(() => {
    getSplashConfig().then(setConfig);
    // Warm the home-feed cache so the preview has real images even if
    // the admin landed here cold.
    const cached = getCachedHomeFeed();
    if (cached && cached.length) setFeedCount(cached.length);
    else prefetchHomeFeed().then(rows => setFeedCount(rows.length)).catch(() => setFeedCount(0));
  }, []);

  const cfg = config ?? DEFAULT_SPLASH_CONFIG;

  const updateEnabled = async (enabled: boolean) => {
    setConfig(c => ({ ...(c ?? DEFAULT_SPLASH_CONFIG), enabled }));
    setSaving(true);
    await setSplashEnabled(enabled);
    setSaving(false);
  };

  const updateDuration = async (durationMs: number) => {
    setConfig(c => ({ ...(c ?? DEFAULT_SPLASH_CONFIG), durationMs }));
  };
  const commitDuration = async (durationMs: number) => {
    setSaving(true);
    await setSplashDuration(durationMs);
    setSaving(false);
  };

  const playPreview = () => {
    setPreviewing(true);
    setReplayKey(k => k + 1);
  };

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1>Splash</h1>
          <p className="admin-page-subtitle">The cinematic cold-open. Preview it live and tune how it plays.</p>
        </div>
      </div>

      {/* Live preview panel */}
      <div style={{
        position: 'relative', borderRadius: 16, overflow: 'hidden',
        border: '1px solid #1f2937', background: '#000',
        aspectRatio: '16 / 9', maxWidth: 880, marginBottom: 20,
      }}>
        {previewing ? (
          <CinematicSplash durationMs={cfg.durationMs} preview replayKey={replayKey} />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#94a3b8' }}>
            <div style={{ fontSize: 13 }}>Cinematic cascade-to-grid splash</div>
            <button className="admin-btn admin-btn-primary" onClick={playPreview} style={{ fontSize: 13 }}>
              ▶ Play preview
            </button>
          </div>
        )}
        {previewing && (
          <button
            onClick={playPreview}
            style={{
              position: 'absolute', bottom: 12, right: 12, zIndex: 500,
              fontSize: 12, padding: '6px 12px', borderRadius: 999,
              background: 'rgba(255,255,255,0.14)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)',
              cursor: 'pointer', backdropFilter: 'blur(8px)',
            }}
          >
            ↻ Replay
          </button>
        )}
      </div>

      {feedCount != null && (
        <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 20px' }}>
          {feedCount > 0
            ? `Animating ${Math.min(24, feedCount)} downscaled images from the live home feed.`
            : 'Home-feed cache is empty — the splash falls back to the logo-only fade until the feed loads once.'}
        </p>
      )}

      {/* Config */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, maxWidth: 880 }}>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, background: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>Splash enabled</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Plays on every cold open of the app.</div>
            </div>
            <label style={{ position: 'relative', display: 'inline-block', width: 44, height: 24, flexShrink: 0 }}>
              <input
                type="checkbox"
                checked={cfg.enabled}
                onChange={e => updateEnabled(e.target.checked)}
                style={{ opacity: 0, width: 0, height: 0 }}
              />
              <span style={{
                position: 'absolute', inset: 0, borderRadius: 999, cursor: 'pointer',
                background: cfg.enabled ? '#16a34a' : '#cbd5e1', transition: 'background 0.15s',
              }} />
              <span style={{
                position: 'absolute', top: 3, left: cfg.enabled ? 23 : 3, width: 18, height: 18,
                borderRadius: '50%', background: '#fff', transition: 'left 0.15s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
            </label>
          </div>
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, background: '#fff' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>Duration</div>
          <div style={{ fontSize: 11, color: '#64748b', margin: '2px 0 12px' }}>
            How long the splash plays before the feed is interactive.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              type="range" min={1500} max={6000} step={100}
              value={cfg.durationMs}
              onChange={e => updateDuration(Number(e.target.value))}
              onMouseUp={e => commitDuration(Number((e.target as HTMLInputElement).value))}
              onTouchEnd={e => commitDuration(Number((e.target as HTMLInputElement).value))}
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#111', minWidth: 56, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {(cfg.durationMs / 1000).toFixed(1)}s
            </span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14, fontSize: 12, color: saving ? '#16a34a' : '#94a3b8' }}>
        {saving ? 'Saving…' : 'Changes save automatically.'}
      </div>
    </div>
  );
}
