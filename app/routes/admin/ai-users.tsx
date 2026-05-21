import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { createAiUser } from '~/services/ai-users';

/**
 * /admin/ai-users — AI persona listing + create flow.
 *
 * Profiles flagged with is_ai=true. AI personas share the same row
 * shape as real users (height, age, gender, last_sign_in_at) so the
 * existing /admin/user/$name detail page renders them with no
 * changes. Creating one goes through the create-ai-user edge
 * function (service role) because profiles.id has a hard FK to
 * auth.users(id).
 */

interface AiUserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  gender: string | null;
  height_cm: number | null;
  height_label: string | null;
  age_label: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
}

export default function AdminAiUsers() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<AiUserRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (!supabase) { setLoaded(true); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, avatar_url, gender, height_cm, height_label, age_label, created_at, last_sign_in_at')
        .eq('is_ai', true)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (error) {
        console.error('[ai-users] load failed:', error.message);
        setRows([]);
      } else {
        setRows((data ?? []) as AiUserRow[]);
      }
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const openProfile = useCallback((id: string) => {
    navigate(`/admin/user/${id}`);
  }, [navigate]);

  return (
    <div className="admin-page">
      <div className="admin-page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1>AI Users</h1>
          <p className="admin-page-subtitle">AI personas that own generated looks alongside real users.</p>
        </div>
        <button
          type="button"
          className="admin-btn admin-btn-primary"
          onClick={() => setCreateOpen(true)}
        >
          + New AI user
        </button>
      </div>

      {!loaded && <div className="admin-empty">Loading…</div>}
      {loaded && rows.length === 0 && (
        <div className="admin-empty">
          No AI users yet. Tap <strong>+ New AI user</strong> to create one.
        </div>
      )}
      {loaded && rows.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Gender</th>
                <th>Height</th>
                <th>Age</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} onClick={() => openProfile(row.id)} style={{ cursor: 'pointer' }}>
                  <td className="admin-cell-name">
                    {row.avatar_url
                      ? <img src={row.avatar_url} alt="" className="admin-user-avatar-img" />
                      : <span className="admin-user-avatar-img admin-user-avatar-placeholder">
                          {(row.full_name || row.email || '?').charAt(0).toUpperCase()}
                        </span>
                    }
                    <span>{row.full_name || row.email || row.id.slice(0, 8)}</span>
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{row.gender || '—'}</td>
                  <td>
                    {row.height_label || (row.height_cm ? `${row.height_cm} cm` : '—')}
                  </td>
                  <td>{row.age_label || '—'}</td>
                  <td className="admin-cell-muted" style={{ whiteSpace: 'nowrap' }}>
                    {row.created_at ? new Date(row.created_at).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <CreateAiUserModal
          onClose={() => setCreateOpen(false)}
          onCreated={(userId) => {
            setCreateOpen(false);
            navigate(`/admin/user/${userId}`);
          }}
        />
      )}
    </div>
  );
}

interface CreateAiUserModalProps {
  onClose: () => void;
  onCreated: (userId: string) => void;
}

function CreateAiUserModal({ onClose, onCreated }: CreateAiUserModalProps) {
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
