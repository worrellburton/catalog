// /admin/splash — choose the cold-open splash concept and tune it.
//
// A row of selectable cards (one per concept + a "None" card to disable)
// sits at the top; clicking a card makes it live and loads it into the
// big preview, which plays the real component with the real downscaled
// home-feed images. Duration is a single saved slider.

import { useEffect, useState } from 'react';
import SplashHost from '~/components/splash/SplashHost';
import { SPLASH_REGISTRY } from '~/components/splash/registry';
import {
  getSplashConfig, setSplashVariant, setSplashDuration,
  DEFAULT_SPLASH_CONFIG, type SplashConfig, type SplashSelection,
} from '~/services/splash-config';
import { getCachedHomeFeed, prefetchHomeFeed } from '~/services/product-creative';

export default function AdminSplash() {
  const [config, setConfig] = useState<SplashConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [replayKey, setReplayKey] = useState(1);
  const [feedCount, setFeedCount] = useState<number | null>(null);

  useEffect(() => {
    getSplashConfig().then(setConfig);
    const cached = getCachedHomeFeed();
    if (cached && cached.length) setFeedCount(cached.length);
    else prefetchHomeFeed().then(rows => setFeedCount(rows.length)).catch(() => setFeedCount(0));
  }, []);

  const cfg = config ?? DEFAULT_SPLASH_CONFIG;

  const selectVariant = async (variant: SplashSelection) => {
    setConfig(c => ({ ...(c ?? DEFAULT_SPLASH_CONFIG), variant, enabled: variant !== 'none' }));
    setReplayKey(k => k + 1);
    setSaving(true);
    await setSplashVariant(variant);
    setSaving(false);
  };

  const updateDuration = (durationMs: number) =>
    setConfig(c => ({ ...(c ?? DEFAULT_SPLASH_CONFIG), durationMs }));
  const commitDuration = async (durationMs: number) => {
    setSaving(true);
    await setSplashDuration(durationMs);
    setSaving(false);
  };

  const activeMeta = SPLASH_REGISTRY.find(v => v.id === cfg.variant);

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1>Splash</h1>
          <p className="admin-page-subtitle">
            Pick the cinematic cold-open. Click a concept to make it live and preview it below.
          </p>
        </div>
      </div>

      {/* Concept picker — cards in a list at the top. */}
      <div className="splash-card-row">
        {/* None disables the splash. */}
        <button
          type="button"
          className={`splash-card is-none ${cfg.variant === 'none' ? 'is-active' : ''}`}
          onClick={() => selectVariant('none')}
        >
          {cfg.variant === 'none' && <span className="splash-card-tick">✓</span>}
          <div className="splash-card-poster">⦸</div>
          <div className="splash-card-body">
            <div className="splash-card-name">None</div>
            <div className="splash-card-tagline">Skip the splash — boot straight to the feed.</div>
          </div>
        </button>

        {SPLASH_REGISTRY.map(meta => (
          <button
            type="button"
            key={meta.id}
            className={`splash-card ${cfg.variant === meta.id ? 'is-active' : ''}`}
            onClick={() => selectVariant(meta.id)}
          >
            {cfg.variant === meta.id && <span className="splash-card-tick">✓</span>}
            <div
              className="splash-card-poster"
              style={{ backgroundImage: `linear-gradient(135deg, ${meta.poster[0]}, ${meta.poster[1]})` }}
            />
            <div className="splash-card-body">
              <div className="splash-card-name">
                {meta.name}
                <span className="splash-card-chip">{meta.tech}</span>
              </div>
              <div className="splash-card-tagline">{meta.tagline}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Big live preview of the active concept. */}
      <div style={{
        position: 'relative', borderRadius: 16, overflow: 'hidden',
        border: '1px solid #1f2937', background: '#000',
        aspectRatio: '16 / 9', maxWidth: 880, margin: '8px 0 12px',
      }}>
        {cfg.variant === 'none' ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 13 }}>
            Splash disabled — the app boots straight to the feed.
          </div>
        ) : (
          <SplashHost key={feedCount ?? 0} variant={cfg.variant} durationMs={cfg.durationMs} preview replayKey={replayKey} />
        )}
        {cfg.variant !== 'none' && (
          <button
            onClick={() => setReplayKey(k => k + 1)}
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
        <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 18px' }}>
          {feedCount > 0
            ? `Using ${Math.min(24, feedCount)} downscaled images (~5KB each) from the live home feed.`
            : 'Home-feed cache is empty — the splash falls back to a logo-only fade until the feed loads once.'}
        </p>
      )}

      {/* Duration */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, background: '#fff', maxWidth: 520 }}>
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

      <div style={{ marginTop: 14, fontSize: 12, color: saving ? '#16a34a' : '#94a3b8' }}>
        {saving ? 'Saving…' : `${activeMeta ? activeMeta.name : 'None'} is live · changes save automatically.`}
      </div>
    </div>
  );
}
