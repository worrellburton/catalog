import { useCallback, useState } from 'react';
import { createAiUser } from '~/services/ai-users';

interface CreateAiUserModalProps {
  onClose: () => void;
  onCreated: (userId: string) => void;
}

/**
 * Reusable "New AI user" modal — used by the AI tab inside
 * /admin/users. Posts to the create-ai-user edge function which
 * provisions the auth row + flips is_ai=true server-side
 * (necessary because profiles.id has a hard FK to auth.users(id)).
 */
export default function CreateAiUserModal({ onClose, onCreated }: CreateAiUserModalProps) {
  const [fullName, setFullName] = useState('');
  const [gender, setGender] = useState<'men' | 'women' | 'unisex' | ''>('');
  const [heightCm, setHeightCm] = useState('');
  const [heightLabel, setHeightLabel] = useState('');
  const [ageLabel, setAgeLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = fullName.trim().length > 0 && !submitting;

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const parsedHeight = heightCm ? parseInt(heightCm, 10) : null;
      const result = await createAiUser({
        full_name: fullName.trim(),
        gender: gender || null,
        height_cm: Number.isFinite(parsedHeight) ? parsedHeight : null,
        height_label: heightLabel.trim() || null,
        age_label: ageLabel.trim() || null,
      });
      onCreated(result.user_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
      setSubmitting(false);
    }
  }, [ageLabel, canSubmit, fullName, gender, heightCm, heightLabel, onCreated]);

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
              <span style={{ fontWeight: 600 }}>Age label</span>
              <input
                type="text"
                value={ageLabel}
                onChange={e => setAgeLabel(e.target.value)}
                placeholder="e.g. 25-29"
                style={{ padding: 8, borderRadius: 6, border: '1px solid #e5e5e5' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span style={{ fontWeight: 600 }}>Height (cm)</span>
              <input
                type="number"
                min={50}
                max={250}
                value={heightCm}
                onChange={e => setHeightCm(e.target.value)}
                placeholder="e.g. 175"
                style={{ padding: 8, borderRadius: 6, border: '1px solid #e5e5e5' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span style={{ fontWeight: 600 }}>Height label</span>
              <input
                type="text"
                value={heightLabel}
                onChange={e => setHeightLabel(e.target.value)}
                placeholder="e.g. 5'9&quot;"
                style={{ padding: 8, borderRadius: 6, border: '1px solid #e5e5e5' }}
              />
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
