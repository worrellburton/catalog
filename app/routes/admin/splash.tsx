// /admin/splash — choose the cold-open splash concept and tune it.
//
// Two-step model: clicking a card SELECTS it (loads it into the live
// preview) without changing production. "Make main" commits the selected
// concept as the live splash (saved to app_settings). The card that's
// currently live carries a "Main" badge. Duration is a saved slider.

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
  // What's currently being previewed (not necessarily what's live).
  const [selected, setSelected] = useState<SplashSelection | null>(null);
  const [saving, setSaving] = useState(false);
  const [replayKey, setReplayKey] = useState(1);
  const [feedCount, setFeedCount] = useState<number | null>(null);
  // The preview does NOT auto-play on page load — opening /admin/splash
  // should just show the page, not fire the animation. It plays only when
  // the admin explicitly hits Play (and re-arms when they pick a card).
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    getSplashConfig().then(cfg => {
      setConfig(cfg);
      setSelected(prev => prev ?? cfg.variant); // preview the live one by default
    });
    const cached = getCachedHomeFeed();
    if (cached && cached.length) setFeedCount(cached.length);
    else prefetchHomeFeed().then(rows => setFeedCount(rows.length)).catch(() => setFeedCount(0));
  }, []);

  const cfg = config ?? DEFAULT_SPLASH_CONFIG;
  const live = cfg.variant;                      // what production uses
  const sel = selected ?? live;                  // what we're previewing
  const isDirty = sel !== live;                  // selection differs from live

  // Select a card → preview only (no save). Picking a different concept
  // resets the preview to its idle (not-playing) state so it doesn't
  // auto-fire; the admin presses Play to watch it.
  const selectCard = (variant: SplashSelection) => {
    setSelected(variant);
    setPlaying(false);
    setReplayKey(k => k + 1);
  };
  const playPreview = () => { setPlaying(true); setReplayKey(k => k + 1); };

  // Commit the selected concept as the live splash.
  const makeMain = async () => {
    setSaving(true);
    await setSplashVariant(sel);
    setConfig(c => ({ ...(c ?? DEFAULT_SPLASH_CONFIG), variant: sel, enabled: sel !== 'none' }));
    setSaving(false);
  };

  const updateDuration = (durationMs: number) =>
    setConfig(c => ({ ...(c ?? DEFAULT_SPLASH_CONFIG), durationMs }));
  const commitDuration = async (durationMs: number) => {
    setSaving(true);
    await setSplashDuration(durationMs);
    setSaving(false);
  };

  const selMeta = SPLASH_REGISTRY.find(v => v.id === sel);
  const liveMeta = SPLASH_REGISTRY.find(v => v.id === live);
  const selLabel = sel === 'none' ? 'None' : (selMeta?.name ?? sel);
  const liveLabel = live === 'none' ? 'None' : (liveMeta?.name ?? live);

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1>Splash</h1>
          <p className="admin-page-subtitle">
            Click a concept to preview it. When you’ve found the one, hit <strong>Make main</strong> to ship it.
          </p>
        </div>
      </div>

      {/* Concept picker — cards in a list at the top. */}
      <div className="splash-card-row">
        {/* None disables the splash. */}
        <div
          role="button"
          tabIndex={0}
          className={`splash-card is-none ${sel === 'none' ? 'is-active' : ''}`}
          onClick={() => selectCard('none')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectCard('none'); } }}
        >
          {live === 'none' && <span className="splash-card-badge">Main</span>}
          {sel === 'none' && <span className="splash-card-tick">✓</span>}
          <div className="splash-card-poster">⦸</div>
          <div className="splash-card-body">
            <div className="splash-card-name">None</div>
            <div className="splash-card-tagline">Skip the splash — boot straight to the feed.</div>
          </div>
        </div>

        {SPLASH_REGISTRY.map(meta => (
          <div
            role="button"
            tabIndex={0}
            key={meta.id}
            className={`splash-card ${sel === meta.id ? 'is-active' : ''}`}
            onClick={() => selectCard(meta.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectCard(meta.id); } }}
          >
            {live === meta.id && <span className="splash-card-badge">Main</span>}
            {sel === meta.id && <span className="splash-card-tick">✓</span>}
            <div
              className="splash-card-poster"
              style={{ backgroundImage: `linear-gradient(135deg, ${meta.poster[0]}, ${meta.poster[1]})` }}
            >
              {/* Preview action — selects this concept AND fires the
                  animation in the big preview pane below. Stops the click
                  so it doesn't double-trigger the card's select handler. */}
              <button
                type="button"
                className="splash-card-preview"
                onClick={(e) => {
                  e.stopPropagation();
                  selectCard(meta.id);
                  // Play right away. selectCard re-arms idle + bumps
                  // replayKey; flipping playing=true on the next tick
                  // ensures SplashHost re-mounts and runs.
                  setTimeout(() => playPreview(), 0);
                }}
                title="Preview this splash in the panel below"
                aria-label={`Preview ${meta.name}`}
              >
                ▶ Preview
              </button>
            </div>
            <div className="splash-card-body">
              <div className="splash-card-name">
                {meta.name}
                <span className="splash-card-chip">{meta.tech}</span>
              </div>
              <div className="splash-card-tagline">{meta.tagline}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Big preview of the SELECTED concept + the commit action. */}
      <div style={{
        position: 'relative', borderRadius: 16, overflow: 'hidden',
        border: '1px solid #1f2937', background: '#000',
        aspectRatio: '16 / 9', maxWidth: 880, margin: '8px 0 12px',
      }}>
        {sel === 'none' ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 13 }}>
            Splash disabled — the app boots straight to the feed.
          </div>
        ) : playing ? (
          <SplashHost key={`${sel}-${feedCount ?? 0}-${replayKey}`} variant={sel} durationMs={cfg.durationMs} preview replayKey={replayKey} />
        ) : (
          // Idle state — no animation until the admin presses Play.
          <button
            onClick={playPreview}
            style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 10,
              background: 'transparent', border: 'none', cursor: 'pointer', color: '#cbd5e1',
            }}
          >
            <span style={{
              width: 56, height: 56, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)', fontSize: 20, color: '#fff',
            }}>▶</span>
            <span style={{ fontSize: 13 }}>Play preview — {selLabel}</span>
          </button>
        )}
        {sel !== 'none' && playing && (
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

      {/* Commit bar — preview vs. live state + Make main. */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 16, flexWrap: 'wrap', maxWidth: 880, margin: '0 0 18px',
        padding: '12px 16px', borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff',
      }}>
        <div style={{ fontSize: 13, color: '#334155' }}>
          <div>
            Previewing <strong>{selLabel}</strong>
            {isDirty
              ? <span style={{ color: '#b45309' }}> · not yet live</span>
              : <span style={{ color: '#16a34a' }}> · this is your main</span>}
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
            Main (what shoppers see on cold open): <strong>{liveLabel}</strong>
          </div>
        </div>
        <button
          className="admin-btn admin-btn-primary"
          onClick={makeMain}
          disabled={saving || !isDirty}
          style={{ fontSize: 13, padding: '9px 18px', opacity: !isDirty ? 0.5 : 1 }}
        >
          {saving ? 'Saving…' : !isDirty ? '✓ Live' : `Make “${selLabel}” main`}
        </button>
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
          How long the splash plays before the feed is interactive. Applies to the main splash.
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
  );
}
