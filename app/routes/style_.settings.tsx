// /style/settings — per-user Style-app preferences (Phase 6.1).
//
// Two sections:
//  • Background preset — saved to localStorage under 'catalog:style-bg'; the
//    root-tsx pre-hydration script reads the same key and stamps
//    html[data-style-bg="…"] before first paint so the picked background
//    paints from frame 0 (no flash of default).
//  • Stylist — only rendered when the signed-in user has a style_up_stylists
//    row (human_user_id = auth.uid()): links into their Inbox / Showroom and
//    the accepting_new switch. Non-stylists see nothing extra; the
//    "Become a stylist" entry lives on the picker.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { useAuth } from '~/hooks/useAuth';
import '~/styles/style-up.css';

type Preset = 'default' | 'plain' | 'warm' | 'cool' | 'paper';

const PRESETS: { id: Preset; label: string; blurb: string }[] = [
  { id: 'default', label: 'Particles', blurb: 'The house look. Soft moving field over black.' },
  { id: 'plain',   label: 'Plain dark', blurb: 'No motion, no shine, just black.' },
  { id: 'warm',    label: 'Warm dusk',  blurb: 'Amber-into-plum radial. Cozy.' },
  { id: 'cool',    label: 'Cool tide',  blurb: 'Slate-into-teal radial. Quiet.' },
  { id: 'paper',   label: 'Paper',      blurb: 'Off-white light mode for this app.' },
];

const KEY = 'catalog:style-bg';

interface StylistRow { id: string; name: string; accepting_new: boolean }

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
  const { user } = useAuth();
  const [pref, setPref] = useState<Preset>('default');
  const [stylist, setStylist] = useState<StylistRow | null>(null);
  const [savingAccept, setSavingAccept] = useState(false);
  const [stylistError, setStylistError] = useState<string | null>(null);
  useEffect(() => { setPref(readPref()); }, []);

  // Is the signed-in user a human stylist? Absent row = not one; render nothing.
  useEffect(() => {
    if (!user) { setStylist(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('style_up_stylists')
        .select('id, name, accepting_new')
        .eq('human_user_id', user.id)
        .maybeSingle();
      if (!cancelled) setStylist((data as StylistRow | null) ?? null);
    })();
    return () => { cancelled = true; };
  }, [user]);

  const pick = useCallback((p: Preset) => {
    setPref(p);
    applyPref(p);
  }, []);

  const toggleAccepting = useCallback(async (next: boolean) => {
    if (!stylist || savingAccept) return;
    const prev = stylist.accepting_new;
    setSavingAccept(true);
    setStylistError(null);
    setStylist({ ...stylist, accepting_new: next });
    // style_up_stylists RLS currently has SELECT-for-all + an admin-only write
    // policy — a stylist editing their own row is filtered out silently (0 rows,
    // no error), so check the returned row count, not just `error`.
    const { data, error } = await supabase
      .from('style_up_stylists')
      .update({ accepting_new: next })
      .eq('id', stylist.id)
      .select('accepting_new');
    if (error || !data || data.length === 0) {
      setStylist({ ...stylist, accepting_new: prev });
      setStylistError(error?.message ?? "Couldn't save. Your account can't edit this yet.");
    }
    setSavingAccept(false);
  }, [stylist, savingAccept]);

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

      {stylist && (
        <>
          <h2 style={{ fontSize: 15, margin: '24px 0 8px' }}>Stylist</h2>
          <div className="su-apply-actions">
            <button type="button" className="su-apply-back" onClick={() => navigate('/style/inbox')}>Inbox</button>
            <button type="button" className="su-apply-back" onClick={() => navigate('/style/showroom')}>Showroom</button>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, margin: '14px 0 4px' }}>
            <input
              type="checkbox"
              checked={stylist.accepting_new}
              disabled={savingAccept}
              onChange={e => void toggleAccepting(e.target.checked)}
            />
            Accepting new shoppers
          </label>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', margin: 0 }}>
            Off takes you out of the stylist picker. Threads you already have keep working.
          </p>
          {stylistError && <div className="su-apply-error">{stylistError}</div>}
        </>
      )}
    </div>
  );
}
