import { useState, useEffect, useCallback } from 'react';
import {
  getWaitlist,
  approveWaitlistEntry,
  removeWaitlistEntry,
  type WaitlistEntry,
} from '~/services/waitlist';

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function AdminShoppersWaitlist() {
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getWaitlist();
    setEntries(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (id: string) => {
    setBusyId(id);
    const { error } = await approveWaitlistEntry(id);
    setBusyId(null);
    if (error) {
      alert(`Failed to approve: ${error}`);
      return;
    }
    await load();
  };

  const handleRemove = async (id: string) => {
    if (!confirm('Remove this person from the waitlist?')) return;
    setBusyId(id);
    const { error } = await removeWaitlistEntry(id);
    setBusyId(null);
    if (error) {
      alert(`Failed to remove: ${error}`);
      return;
    }
    await load();
  };

  const pending = entries.filter(e => !e.approved);
  const approved = entries.filter(e => e.approved);

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Shoppers Waitlist</h1>
        <p className="admin-page-subtitle">
          {loading
            ? 'Loading…'
            : `${pending.length} waiting · ${approved.length} approved`}
        </p>
      </div>

      {loading ? (
        <div className="admin-empty">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="admin-empty">No one on the waitlist yet.</div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 64 }}>#</th>
                <th>Name</th>
                <th>Contact</th>
                <th style={{ width: 100 }}>Provider</th>
                <th>Joined</th>
                <th style={{ width: 100 }}>Status</th>
                <th style={{ width: 180 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => {
                const name = e.full_name || e.email?.split('@')[0] || 'Unknown';
                const contact = e.email || '-';
                const isBusy = busyId === e.id;
                return (
                  <tr key={e.id}>
                    <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>#{e.position}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {e.avatar_url ? (
                          <img
                            src={e.avatar_url}
                            alt=""
                            style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }}
                          />
                        ) : (
                          <span
                            style={{
                              width: 28, height: 28, borderRadius: '50%',
                              background: '#e8e8e8', color: '#666',
                              fontSize: 11, fontWeight: 700,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                          >
                            {name.slice(0, 2).toUpperCase()}
                          </span>
                        )}
                        <span>{name}</span>
                      </div>
                    </td>
                    <td style={{ color: '#666', fontSize: 13 }}>{contact}</td>
                    <td style={{ color: '#888', fontSize: 12, textTransform: 'capitalize' }}>
                      {e.provider || '-'}
                    </td>
                    <td style={{ color: '#888', fontSize: 12 }}>{formatDateTime(e.created_at)}</td>
                    <td>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '3px 8px',
                          fontSize: 11,
                          fontWeight: 600,
                          borderRadius: 12,
                          background: e.approved ? '#dcfce7' : '#fef3c7',
                          color: e.approved ? '#166534' : '#92400e',
                        }}
                      >
                        {e.approved ? 'Approved' : 'Waiting'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {!e.approved && (
                          <button
                            onClick={() => handleApprove(e.id)}
                            disabled={isBusy}
                            style={{
                              fontSize: 12, fontWeight: 600,
                              padding: '5px 10px', borderRadius: 6,
                              background: '#10b981', color: '#fff', border: 'none',
                              cursor: isBusy ? 'wait' : 'pointer',
                              opacity: isBusy ? 0.6 : 1,
                            }}
                          >
                            Approve
                          </button>
                        )}
                        <button
                          onClick={() => handleRemove(e.id)}
                          disabled={isBusy}
                          style={{
                            fontSize: 12, fontWeight: 500,
                            padding: '5px 10px', borderRadius: 6,
                            background: 'transparent', color: '#ef4444',
                            border: '1px solid #fecaca',
                            cursor: isBusy ? 'wait' : 'pointer',
                            opacity: isBusy ? 0.6 : 1,
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
