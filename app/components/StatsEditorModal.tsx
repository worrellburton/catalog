/**
 * Inline editor for the user's "stats" — height, age, gender. Persists
 * to `profiles` via `updateUserHeightAge` + `updateUserGender`. Shared
 * between /style and /generate so the stats can be edited from either
 * surface without bouncing between routes.
 */

import { useEffect, useMemo, useState } from 'react';
import { updateUserHeightAge, updateUserFullName } from '~/services/profiles';
import { updateUserGender, type UserGender } from '~/services/genders';
import { HEIGHT_OPTIONS, AGE_OPTIONS } from '~/constants/stats';

export interface StatsBits {
  heightCm: number | null;
  heightLabel: string | null;
  ageLabel: string | null;
  gender: UserGender;
  /** Only carried when the modal was opened with `editName=true`. The
   *  consumer-facing /style + /generate surfaces don't surface the
   *  name field; the admin AI persona editor does. */
  fullName?: string | null;
}

interface Props {
  userId: string;
  initial: StatsBits;
  onClose: () => void;
  onSaved: (next: StatsBits) => void;
  /** When true, the modal renders a Name field above Height + commits
   *  the new value via updateUserFullName. Used by /admin/user/<id>
   *  to rename AI personas inline. */
  editName?: boolean;
  /** Optional title override — defaults to "Your stats" so /style and
   *  /generate keep their current copy. The admin editor reads "Edit
   *  profile" instead. */
  title?: string;
}

export default function StatsEditorModal({ userId, initial, onClose, onSaved, editName, title }: Props) {
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
  const [fullName, setFullName] = useState<string>(initial.fullName ?? '');
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
    const promises: Promise<{ error?: string | null }>[] = [
      updateUserHeightAge(userId, { heightCm, heightLabel, ageLabel }),
      updateUserGender(userId, gender),
    ];
    if (editName) {
      promises.push(updateUserFullName(userId, fullName));
    }
    const results = await Promise.all(promises);
    setSaving(false);
    const firstError = results.find(r => r.error)?.error;
    if (firstError) { setError(firstError); return; }
    onSaved({
      heightCm,
      heightLabel,
      ageLabel,
      gender,
      ...(editName ? { fullName: fullName.trim() } : {}),
    });
  }

  return (
    <div className="style-stats-modal" onClick={onClose} role="dialog" aria-modal="true">
      <div className="style-stats-card" onClick={e => e.stopPropagation()}>
        <div className="style-stats-header">
          <h2>{title ?? 'Your stats'}</h2>
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

        {editName && (
          <label className="style-stats-field">
            <span className="style-stats-label">Name</span>
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              disabled={saving}
              placeholder="e.g. Ava — Fall Editorial"
            />
          </label>
        )}

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
