/**
 * Admin-only profile editor. Replaces the StatsEditorModal on the
 * admin user-detail page — StatsEditorModal's CSS lives in
 * style-page.css which isn't shipped to admin routes, so it rendered
 * as bare HTML.
 *
 * This is a slide-over sheet (right-edge panel that springs in) with:
 *   - Floating labels that lift on focus / fill
 *   - Inline gender segmented control
 *   - Optimistic save + animated checkmark on success
 *   - Esc / backdrop click to dismiss; focus trap; reduced-motion respected
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { HEIGHT_OPTIONS, WEIGHT_OPTIONS, AGE_OPTIONS } from '~/constants/stats';
import { updateUserHeightAge, updateUserFullName } from '~/services/profiles';
import { updateUserGender, type UserGender } from '~/services/genders';

export interface AdminProfileEditorInitial {
  fullName: string | null;
  heightCm: number | null;
  heightLabel: string | null;
  weightKg: number | null;
  weightLabel: string | null;
  ageLabel: string | null;
  gender: UserGender;
  isAi: boolean;
  email: string | null;
}

interface Props {
  userId: string;
  initial: AdminProfileEditorInitial;
  onClose: () => void;
  onSaved: (next: {
    fullName: string;
    heightCm: number;
    heightLabel: string;
    weightKg: number;
    weightLabel: string;
    ageLabel: string;
    gender: UserGender;
  }) => void;
}

export default function AdminProfileEditor({ userId, initial, onClose, onSaved }: Props) {
  const initialHeight = useMemo(() => {
    if (initial.heightCm) {
      const byCm = HEIGHT_OPTIONS.find(h => h.cm === initial.heightCm);
      if (byCm) return byCm;
    }
    if (initial.heightLabel) {
      const byLabel = HEIGHT_OPTIONS.find(h => h.label === initial.heightLabel);
      if (byLabel) return byLabel;
    }
    return HEIGHT_OPTIONS.find(h => h.label === "5'10\"") ?? HEIGHT_OPTIONS[0];
  }, [initial.heightCm, initial.heightLabel]);

  const initialWeight = useMemo(() => {
    if (initial.weightKg != null) {
      const byKg = WEIGHT_OPTIONS.find(w => w.kg === initial.weightKg);
      if (byKg) return byKg;
    }
    if (initial.weightLabel) {
      const byLabel = WEIGHT_OPTIONS.find(w => w.label === initial.weightLabel);
      if (byLabel) return byLabel;
    }
    return WEIGHT_OPTIONS.find(w => w.label === '160 lb') ?? WEIGHT_OPTIONS[Math.floor(WEIGHT_OPTIONS.length / 2)];
  }, [initial.weightKg, initial.weightLabel]);

  const [fullName, setFullName] = useState(initial.fullName ?? '');
  const [heightCm, setHeightCm] = useState<number>(initialHeight.cm);
  const [heightLabel, setHeightLabel] = useState<string>(initialHeight.label);
  const [weightKg, setWeightKg] = useState<number>(initialWeight.kg);
  const [weightLabel, setWeightLabel] = useState<string>(initialWeight.label);
  const [ageLabel, setAgeLabel] = useState<string>(initial.ageLabel ?? 'mid 20s');
  const [gender, setGender] = useState<UserGender>(initial.gender);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Trigger the slide-in animation one frame after mount. Without the
  // double-rAF the initial off-screen transform paints simultaneously
  // with the transform back to 0 and the user never sees the slide.
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setMounted(true)));
    return () => cancelAnimationFrame(id);
  }, []);

  // Esc dismiss + simple focus trap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab' && sheetRef.current) {
        const focusables = sheetRef.current.querySelectorAll<HTMLElement>(
          'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
        else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSavedFlash(false);
    const results = await Promise.all([
      updateUserHeightAge(userId, { heightCm, heightLabel, weightKg, weightLabel, ageLabel }),
      updateUserGender(userId, gender),
      updateUserFullName(userId, fullName),
    ]);
    setSaving(false);
    const firstError = results.find(r => r?.error)?.error;
    if (firstError) { setError(firstError); return; }
    setSavedFlash(true);
    setTimeout(() => {
      onSaved({ fullName: fullName.trim(), heightCm, heightLabel, weightKg, weightLabel, ageLabel, gender });
    }, 350);
  }

  const isDirty =
    fullName !== (initial.fullName ?? '') ||
    heightCm !== (initial.heightCm ?? initialHeight.cm) ||
    weightKg !== (initial.weightKg ?? initialWeight.kg) ||
    ageLabel !== (initial.ageLabel ?? 'mid 20s') ||
    gender !== initial.gender;

  return (
    <div
      className={`ape-backdrop ${mounted ? 'is-mounted' : ''}`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ape-title"
    >
      <div
        ref={sheetRef}
        className={`ape-sheet ${mounted ? 'is-mounted' : ''}`}
        onClick={e => e.stopPropagation()}
      >
        <header className="ape-header">
          <div className="ape-header-inner">
            <div className="ape-eyebrow">
              <span className={`ape-kind-chip ${initial.isAi ? 'is-ai' : 'is-human'}`}>
                {initial.isAi ? (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 2l1.7 4.3L18 8l-4.3 1.7L12 14l-1.7-4.3L6 8l4.3-1.7L12 2zm6 12l1 2.5L21.5 17 19 18l-1 2.5L17 18l-2.5-1L17 16l1-2z"/>
                    </svg>
                    AI persona
                  </>
                ) : (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="8" r="4"/>
                      <path d="M4 21v-1a8 8 0 0 1 16 0v1"/>
                    </svg>
                    Human
                  </>
                )}
              </span>
              {initial.email && <span className="ape-email">{initial.email}</span>}
            </div>
            <h2 id="ape-title">Edit profile</h2>
            <p>These stats power every generated look so the model matches the build.</p>
          </div>
          <button
            type="button"
            className="ape-close"
            onClick={onClose}
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </header>

        <div className="ape-body">
          <FloatField label="Name" value={fullName}>
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              disabled={saving}
              placeholder=" "
              autoFocus
            />
          </FloatField>

          <div className="ape-row">
            <FloatField label="Height" value={String(heightCm)}>
              <select
                value={heightCm}
                onChange={e => {
                  const cm = Number(e.target.value);
                  const opt = HEIGHT_OPTIONS.find(h => h.cm === cm);
                  if (!opt) return;
                  setHeightCm(opt.cm);
                  setHeightLabel(opt.label);
                }}
                disabled={saving}
              >
                {HEIGHT_OPTIONS.map(h => (
                  <option key={h.cm} value={h.cm}>{h.label}</option>
                ))}
              </select>
            </FloatField>
            <FloatField label="Weight" value={String(weightKg)}>
              <select
                value={weightKg}
                onChange={e => {
                  const kg = Number(e.target.value);
                  const opt = WEIGHT_OPTIONS.find(w => w.kg === kg);
                  if (!opt) return;
                  setWeightKg(opt.kg);
                  setWeightLabel(opt.label);
                }}
                disabled={saving}
              >
                {WEIGHT_OPTIONS.map(w => (
                  <option key={w.kg} value={w.kg}>{w.label}</option>
                ))}
              </select>
            </FloatField>
          </div>

          <FloatField label="Age" value={ageLabel}>
            <select
              value={ageLabel}
              onChange={e => setAgeLabel(e.target.value)}
              disabled={saving}
            >
              {AGE_OPTIONS.map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </FloatField>

          <fieldset className="ape-segmented">
            <legend>Gender</legend>
            <div className="ape-segmented-options">
              {(['male', 'female', 'unknown'] as const).map(g => (
                <label
                  key={g}
                  className={`ape-segmented-opt ${gender === g ? 'is-selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="ape-gender"
                    value={g}
                    checked={gender === g}
                    onChange={() => setGender(g)}
                    disabled={saving}
                  />
                  <span>{g === 'unknown' ? 'Prefer not to say' : g}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {error && <div className="ape-error" role="alert">{error}</div>}
        </div>

        <footer className="ape-footer">
          <button
            type="button"
            className="ape-btn ape-btn-ghost"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`ape-btn ape-btn-primary ${savedFlash ? 'is-saved' : ''}`}
            onClick={handleSave}
            disabled={saving || !isDirty || savedFlash}
          >
            <span className="ape-btn-label">
              {savedFlash ? 'Saved' : saving ? 'Saving…' : 'Save changes'}
            </span>
            <svg className="ape-btn-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </button>
        </footer>
      </div>
    </div>
  );
}

// Floating-label wrapper for an <input> or <select>. Labels lift to
// the top edge when the field is focused or filled.
function FloatField({ label, value, children }: { label: string; value: string; children: React.ReactElement }) {
  const filled = value !== '' && value !== undefined && value !== null;
  return (
    <label className={`ape-float ${filled ? 'is-filled' : ''}`}>
      {children}
      <span className="ape-float-label">{label}</span>
    </label>
  );
}
