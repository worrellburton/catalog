/**
 * Inline editor for the user's "stats" — height, age, gender. Persists
 * to `profiles` via `updateUserHeightAge` + `updateUserGender`. Shared
 * between /style and /generate so the stats can be edited from either
 * surface without bouncing between routes.
 */

import { useEffect, useMemo, useState } from 'react';
import { updateUserHeightAge } from '~/services/profiles';
import { updateUserGender, type UserGender } from '~/services/genders';
import { HEIGHT_OPTIONS, AGE_OPTIONS } from '~/constants/stats';

export interface StatsBits {
  heightCm: number | null;
  heightLabel: string | null;
  ageLabel: string | null;
  gender: UserGender;
}

interface Props {
  userId: string;
  initial: StatsBits;
  onClose: () => void;
  onSaved: (next: StatsBits) => void;
}

export default function StatsEditorModal({ userId, initial, onClose, onSaved }: Props) {
  // Resolve the height dropdown's selection from the saved cm value
  // when present, otherwise fall back to a label match so users who
  // only have the label persisted still land on the right row.
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

  const [heightCm, setHeightCm] = useState<number>(initialHeight.cm);
  const [heightLabel, setHeightLabel] = useState<string>(initialHeight.label);
  const [ageLabel, setAgeLabel] = useState<string>(initial.ageLabel ?? 'mid 20s');
  const [gender, setGender] = useState<UserGender>(initial.gender);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const [heightResult, genderResult] = await Promise.all([
      updateUserHeightAge(userId, { heightCm, heightLabel, ageLabel }),
      updateUserGender(userId, gender),
    ]);
    setSaving(false);
    if (heightResult.error) { setError(heightResult.error); return; }
    if (genderResult.error) { setError(genderResult.error); return; }
    onSaved({ heightCm, heightLabel, ageLabel, gender });
  }

  return (
    <div className="style-stats-modal" onClick={onClose} role="dialog" aria-modal="true">
      <div className="style-stats-card" onClick={e => e.stopPropagation()}>
        <div className="style-stats-header">
          <h2>Your stats</h2>
          <button
            type="button"
            className="style-stats-close"
            onClick={onClose}
            aria-label="Close"
          >×</button>
        </div>
        <p className="style-stats-hint">
          These get used in every generated look so the model matches your build.
        </p>

        <label className="style-stats-field">
          <span className="style-stats-label">Height</span>
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
        </label>

        <label className="style-stats-field">
          <span className="style-stats-label">Age</span>
          <select
            value={ageLabel}
            onChange={e => setAgeLabel(e.target.value)}
            disabled={saving}
          >
            {AGE_OPTIONS.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>

        <fieldset className="style-stats-field">
          <span className="style-stats-label">Gender</span>
          <div className="style-stats-gender">
            {(['male', 'female', 'unknown'] as const).map(g => (
              <label key={g} className={`style-stats-gender-opt${gender === g ? ' is-selected' : ''}`}>
                <input
                  type="radio"
                  name="style-stats-gender"
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

        {error && <div className="style-error">{error}</div>}

        <div className="style-stats-actions">
          <button
            type="button"
            className="style-stats-cancel"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="style-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
