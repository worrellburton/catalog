import { useEffect, useState, useCallback } from 'react';
import {
  listCreatorRequests,
  reviewCreatorRequest,
  type CreatorRequestWithProfile,
  type CreatorRequestStatus,
} from '~/services/become-creator';

/**
 * /admin/incoming-creators — shopper applications to become a creator.
 * Approving promotes the user's profiles.role to 'creator' (via the
 * admin-gated review_creator_request RPC); denying just marks the request.
 */

const TABS: Array<{ id: CreatorRequestStatus | 'all'; label: string }> = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'denied', label: 'Denied' },
  { id: 'all', label: 'All' },
];

export default function AdminIncomingCreators() {
  const [tab, setTab] = useState<CreatorRequestStatus | 'all'>('pending');
  const [rows, setRows] = useState<CreatorRequestWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    listCreatorRequests(tab === 'all' ? undefined : tab)
      .then(data => { setRows(data); setLoading(false); })
      .catch(err => { setError(err instanceof Error ? err.message : 'Failed to load'); setLoading(false); });
  }, [tab]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleReview = useCallback(async (id: string, approve: boolean) => {
    setBusyId(id);
    setError(null);
    const { error: err } = await reviewCreatorRequest(id, approve);
    setBusyId(null);
    if (err) { setError(err); return; }
    refresh();
  }, [refresh]);

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Incoming Creators</h1>
        <p className="admin-page-subtitle">Shopper applications to become a creator</p>
      </div>

      <div className="admin-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`admin-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="admin-error">{error}</div>}

      {loading ? (
        <div className="admin-empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="admin-empty">No {tab === 'all' ? '' : tab} requests.</div>
      ) : (
        <div className="admin-creator-requests">
          {rows.map(r => (
            <div key={r.id} className="admin-creator-request">
              <div className="admin-creator-request-who">
                {r.profile?.avatar_url
                  ? <img className="admin-creator-request-avatar" src={r.profile.avatar_url} alt="" />
                  : <div className="admin-creator-request-avatar admin-creator-request-avatar--empty" />}
                <div className="admin-creator-request-meta">
                  <span className="admin-creator-request-name">{r.profile?.full_name || 'Unknown user'}</span>
                  <span className="admin-creator-request-sub">
                    {new Date(r.created_at).toLocaleDateString()}
                    {r.profile?.role ? ` · ${r.profile.role}` : ''}
                  </span>
                  {r.message && <p className="admin-creator-request-msg">{r.message}</p>}
                </div>
              </div>
              <div className="admin-creator-request-actions">
                {r.status === 'pending' ? (
                  <>
                    <button
                      className="admin-btn admin-btn--approve"
                      disabled={busyId === r.id}
                      onClick={() => handleReview(r.id, true)}
                    >
                      {busyId === r.id ? '…' : 'Approve'}
                    </button>
                    <button
                      className="admin-btn admin-btn--deny"
                      disabled={busyId === r.id}
                      onClick={() => handleReview(r.id, false)}
                    >
                      Deny
                    </button>
                  </>
                ) : (
                  <span className={`admin-creator-request-status admin-creator-request-status--${r.status}`}>
                    {r.status}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
