// /style/settings — per-user Style-app preferences (Phase 6.1).
//
// Currently one setting: background preset. Saved to localStorage under
// 'catalog:style-bg'; the root-tsx pre-hydration script reads the same key
// and stamps html[data-style-bg="…"] before first paint so the picked
// background paints from frame 0 (no flash of default).
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import '~/styles/style-up.css';

type Preset = 'default' | 'plain' | 'warm' | 'cool' | 'paper';

const PRESETS: { id: Preset; label: string; blurb: string }[] = [
  { id: 'default', label: 'Particles', blurb: 'The house look — soft moving field over black.' },
  { id: 'plain',   label: 'Plain dark', blurb: 'No motion, no shine, just black.' },
  { id: 'warm',    label: 'Warm dusk',  blurb: 'Amber-into-plum radial. Cozy.' },
  { id: 'cool',    label: 'Cool tide',  blurb: 'Slate-into-teal radial. Quiet.' },
  { id: 'paper',   label: 'Paper',      blurb: 'Off-white light mode for this app.' },
];

const KEY = 'catalog:style-bg';

function readPref(): Preset {
  try { const v = localStorage.getItem(KEY); if (v && PRESETS.some(p => p.id === v)) return v as Preset; } catch { /* private */ }
  return 'default';
}

function applyPref(p: Preset) {
  document.documentElement.dataset.styleBg = p;
  try { localStorage.setItem(KEY, p); } catch { /* private */ }
}

export default function StyleSettingsRoute() {
  const navigate = useNavigate();
  const [pref, setPref] = useState<Preset>('default');
  useEffect(() => { setPref(readPref()); }, []);

  const pick = useCallback((p: Preset) => {
    setPref(p);
    applyPref(p);
  }, []);

  return (
    <div className="su-apply">
      <header className="su-showroom-head">
        <button type="button" className="su-apply-back" onClick={() => navigate('/style')}>← Back</button>
        <h1>Settings</h1>
      </header>
      <h2 style={{ fontSize: 15, margin: '16px 0 8px' }}>Background</h2>
      <div className="su-settings-bg-grid">
        {PRESETS.map(p => (
          <button
            key={p.id}
            type="button"
            className={'su-settings-bg-tile' + (pref === p.id ? ' is-active' : '')}
            data-bg={p.id}
            onClick={() => pick(p.id)}
          >
            <span className="su-settings-bg-swatch" data-bg={p.id} aria-hidden="true" />
            <span className="su-settings-bg-info">
              <span className="su-settings-bg-label">{p.label}</span>
              <span className="su-settings-bg-blurb">{p.blurb}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
