import { useCallback, useState } from 'react';
import { createAiUser } from '~/services/ai-users';
import { HEIGHT_OPTIONS, WEIGHT_OPTIONS, AGE_OPTIONS } from '~/constants/stats';

interface CreateAiUserModalProps {
  onClose: () => void;
  onCreated: (userId: string) => void;
}

/**
 * Reusable "New AI user" modal — used by the AI tab inside
 * /admin/users. Posts to the create-ai-user edge function which
 * provisions the auth row + flips is_ai=true server-side
 * (necessary because profiles.id has a hard FK to auth.users(id)).
 *
 * Height + age use the shared HEIGHT_OPTIONS / AGE_OPTIONS sets from
 * `~/constants/stats` so the label strings the AI persona inherits
 * match exactly what /generate and /style serve real shoppers —
 * Seedance hears the same height phrase regardless of how the persona
 * was created.
 */
export default function CreateAiUserModal({ onClose, onCreated }: CreateAiUserModalProps) {
  const [fullName, setFullName] = useState('');
  const [gender, setGender] = useState<'men' | 'women' | 'unisex' | ''>('');
  // Single height picker: storing cm as the key keeps the label string
  // derivable so we never end up with a label that doesn't match the
  // cm value (the typo-prone case the free-text field caused).
  const [heightCm, setHeightCm] = useState<number | ''>('');
  const [weightKg, setWeightKg] = useState<number | ''>('');
  const [ageLabel, setAgeLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const heightLabel = heightCm === '' ? '' : (HEIGHT_OPTIONS.find(h => h.cm === heightCm)?.label ?? '');
  const weightLabel = weightKg === '' ? '' : (WEIGHT_OPTIONS.find(w => w.kg === weightKg)?.label ?? '');

  const canSubmit = fullName.trim().length > 0 && !submitting;

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createAiUser({
        full_name: fullName.trim(),
        gender: gender || null,
        height_cm: heightCm === '' ? null : heightCm,
        height_label: heightLabel || null,
        weight_kg: weightKg === '' ? null : weightKg,
        weight_label: weightLabel || null,
        age_label: ageLabel || null,
      });
      onCreated(result.user_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
      setSubmitting(false);
    }
  }, [ageLabel, canSubmit, fullName, gender, heightCm, heightLabel, weightKg, weightLabel, onCreated]);

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <form className="admin-modal" onClick={e => e.stopPropagation()} onSubmit={handleSubmit} style={{ maxWidth: 480 }}>
        <div className="admin-modal-header">
          <h3>New AI user</h3>
          <button type="button" className="admin-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="admin-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 13, color: '#888', margin: 0 }}>
            Creates a profile flagged <code>is_ai=true</code> with an underlying
            synthetic auth row. You'll land on the detail page where you can
            upload reference photos.
          </p>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            <span style={{ fontWeight: 600 }}>Name <span style={{ color: '#dc2626' }}>*</span></span>
            <input
              type="text"
              required
              autoFocus
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="e.g. Ava — Fall Editorial"
              style={{ padding: 8, borderRadius: 6, border: '1px solid #e5e5e5' }}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span style={{ fontWeight: 600 }}>Gender</span>
              <select
                value={gender}
                onChange={e => setGender(e.target.value as 'men' | 'women' | 'unisex' | '')}
                style={{ padding: 8, borderRadius: 6, border: '1px solid #e5e5e5' }}
              >
                <option value="">—</option>
                <option value="women">women</option>
                <option value="men">men</option>
                <option value="unisex">unisex</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span style={{ fontWeight: 600 }}>Age</span>
              <select
                value={ageLabel}
                onChange={e => setAgeLabel(e.target.value)}
                style={{ padding: 8, borderRadius: 6, border: '1px solid #e5e5e5' }}
              >
                <option value="">—</option>
                {AGE_OPTIONS.map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span style={{ fontWeight: 600 }}>Height</span>
              <select
                value={heightCm === '' ? '' : String(heightCm)}
                onChange={e => setHeightCm(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                style={{ padding: 8, borderRadius: 6, border: '1px solid #e5e5e5' }}
              >
                <option value="">—</option>
                {HEIGHT_OPTIONS.map(h => (
                  <option key={h.cm} value={h.cm}>{h.label} ({h.cm} cm)</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span style={{ fontWeight: 600 }}>Weight</span>
              <select
                value={weightKg === '' ? '' : String(weightKg)}
                onChange={e => setWeightKg(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                style={{ padding: 8, borderRadius: 6, border: '1px solid #e5e5e5' }}
              >
                <option value="">—</option>
                {WEIGHT_OPTIONS.map(w => (
                  <option key={w.kg} value={w.kg}>{w.label} ({w.kg} kg)</option>
                ))}
              </select>
            </label>
          </div>
          {error && (
            <div style={{ fontSize: 12, color: '#dc2626' }}>{error}</div>
          )}
        </div>
        <div className="admin-modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="admin-btn admin-btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" className="admin-btn admin-btn-primary" disabled={!canSubmit}>
            {submitting ? 'Creating…' : 'Create AI user'}
          </button>
        </div>
      </form>
    </div>
  );
}
