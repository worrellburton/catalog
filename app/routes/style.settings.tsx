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
//
// Chrome (header, section headings, rows, switch) is the shared `.su-sub`
// vocabulary in style-up.css, which mirrors the Catalog app's own sub-pages.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { useAuth } from '~/hooks/useAuth';
import { StylePageHeader } from '~/components/style-up/StylePageHeader';
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

const Chevron = () => (
  <svg className="su-sub-row-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
);

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
    <div className="su-apply su-sub">
      <StylePageHeader title="Settings" onBack={() => navigate('/style')} backLabel="Back to Style" />

      <section className="su-sub-section">
        <h2 className="su-sub-section-title">Background</h2>
        <p className="su-sub-section-desc">Sets the backdrop for the whole Style app. Saved on this device.</p>
        <div className="su-settings-bg-grid">
          {PRESETS.map(p => (
            <button
              key={p.id}
              type="button"
              className={'su-settings-bg-tile' + (pref === p.id ? ' is-active' : '')}
              data-bg={p.id}
              aria-pressed={pref === p.id}
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
      </section>

      {stylist && (
        <section className="su-sub-section">
          <h2 className="su-sub-section-title">Stylist</h2>
          <p className="su-sub-section-desc">You&apos;re styling as {stylist.name}.</p>
          <div className="su-sub-rows">
            <button type="button" className="su-sub-row" onClick={() => navigate('/style/inbox')}>
              <span className="su-sub-row-label">
                Inbox
                <span className="su-sub-row-sub">Shopper conversations assigned to you.</span>
              </span>
              <Chevron />
            </button>
            <button type="button" className="su-sub-row" onClick={() => navigate('/style/showroom')}>
              <span className="su-sub-row-label">
                Showroom
                <span className="su-sub-row-sub">The picks you send from, by gender.</span>
              </span>
              <Chevron />
            </button>
            <label className="su-sub-row">
              <span className="su-sub-row-label">
                Accepting new shoppers
                <span className="su-sub-row-sub">Off takes you out of the stylist picker. Threads you already have keep working.</span>
              </span>
              <span className="su-switch">
                <input
                  type="checkbox"
                  checked={stylist.accepting_new}
                  disabled={savingAccept}
                  onChange={e => void toggleAccepting(e.target.checked)}
                />
                <span className="su-switch-track" aria-hidden="true" />
              </span>
            </label>
          </div>
          {stylistError && <div className="su-apply-error">{stylistError}</div>}
        </section>
      )}
    </div>
  );
}
