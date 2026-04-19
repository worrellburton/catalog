import { useState, useEffect, useCallback } from 'react';
import {
  getModerationQueue,
  setAdLive,
  rejectAd,
  regenerateAd,
  deleteProductAd,
  type ProductAd,
} from '~/services/product-ads';

type Action = 'approved' | 'rejected' | 'regenerated' | 'deleted';

export default function AdminModeration() {
  const [queue, setQueue] = useState<ProductAd[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<{ id: string; action: Action } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getModerationQueue();
    setQueue(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handle = useCallback(async (id: string, action: Action, fn: () => Promise<{ error: string | null }>) => {
    setBusyId(id);
    const { error } = await fn();
    setBusyId(null);
    if (!error) {
      setQueue(prev => prev.filter(a => a.id !== id));
      setLastAction({ id, action });
      setTimeout(() => setLastAction(null), 2500);
    }
  }, []);

  return (
    <div className="admin-page">
      <div className="admin-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Moderation Queue</h1>
          <p className="admin-page-subtitle">
            Review newly-generated ads before they go live in the feed. Approved ads start serving immediately.
          </p>
        </div>
        <button className="admin-btn admin-btn-secondary" onClick={load} disabled={loading}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          Refresh
        </button>
      </div>

      <div style={{ display: 'flex', gap: 20, padding: '10px 0', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>{queue.length}</span>
          <span style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Awaiting review</span>
        </div>
      </div>

      {lastAction && (
        <div style={{
          padding: '8px 12px', marginBottom: 12, borderRadius: 6,
          background: lastAction.action === 'approved' ? '#ecfdf5' : '#fef2f2',
          border: `1px solid ${lastAction.action === 'approved' ? '#a7f3d0' : '#fecaca'}`,
          color: lastAction.action === 'approved' ? '#047857' : '#b91c1c',
          fontSize: 12, fontWeight: 600,
        }}>
          {lastAction.action === 'approved' && '✓ Approved — now live in the feed'}
          {lastAction.action === 'rejected' && '✕ Rejected — paused and hidden from feed'}
          {lastAction.action === 'regenerated' && '↻ Regenerating — new video queued'}
          {lastAction.action === 'deleted' && '🗑 Deleted'}
        </div>
      )}

      {loading ? (
        <div className="admin-empty">Loading…</div>
      ) : queue.length === 0 ? (
        <div className="admin-empty" style={{ padding: '60px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 4 }}>Nothing to review</div>
          <div style={{ fontSize: 12, color: '#888' }}>All finished ads have been reviewed.</div>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 20,
        }}>
          {queue.map(ad => (
            <div
              key={ad.id}
              style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: 12,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                opacity: busyId === ad.id ? 0.5 : 1,
                transition: 'opacity 0.2s',
              }}
            >
              {/* Video preview */}
              <div style={{
                aspectRatio: '9 / 16',
                background: '#000',
                position: 'relative',
                overflow: 'hidden',
              }}>
                {ad.video_url && (
                  <video
                    src={ad.video_url}
                    autoPlay muted loop playsInline
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                )}
                <div style={{
                  position: 'absolute', top: 8, left: 8,
                  padding: '3px 8px', borderRadius: 4,
                  background: 'rgba(0,0,0,0.6)', color: '#fff',
                  fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px',
                }}>
                  {ad.style.replace(/_/g, ' ')}
                </div>
              </div>

              {/* Product info */}
              <div style={{ padding: '10px 12px', borderBottom: '1px solid #f5f5f5' }}>
                <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {ad.product?.brand || '—'}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ad.product?.name || 'Unnamed'}
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                  {ad.product?.price || ''}
                </div>
              </div>

              {/* Actions */}
              <div style={{ padding: 8, display: 'flex', gap: 6 }}>
                <button
                  className="admin-btn admin-btn-primary"
                  style={{ flex: 1, fontSize: 12, padding: '6px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                  disabled={busyId === ad.id}
                  onClick={() => handle(ad.id, 'approved', () => setAdLive(ad.id))}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Approve
                </button>
                <button
                  className="admin-btn admin-btn-secondary"
                  style={{ fontSize: 12, padding: '6px 10px', color: '#b91c1c' }}
                  disabled={busyId === ad.id}
                  onClick={() => handle(ad.id, 'rejected', () => rejectAd(ad.id))}
                  title="Reject — pause this ad"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
                <button
                  className="admin-btn admin-btn-secondary"
                  style={{ fontSize: 12, padding: '6px 10px' }}
                  disabled={busyId === ad.id}
                  onClick={() => handle(ad.id, 'regenerated', () => regenerateAd(ad.id))}
                  title="Regenerate"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                  </svg>
                </button>
                <button
                  className="admin-btn admin-btn-secondary"
                  style={{ fontSize: 12, padding: '6px 10px', color: '#64748b' }}
                  disabled={busyId === ad.id}
                  onClick={() => handle(ad.id, 'deleted', () => deleteProductAd(ad.id))}
                  title="Delete"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
