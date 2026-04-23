import { useState, useEffect, useCallback } from 'react';
import {
  listCrawlJobs,
  createProfileCrawlJob,
  triggerProfileCrawl,
  deleteCrawlJob,
  retryCrawlJob,
  type CrawlJob,
} from '~/services/site-crawls';

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  crawling: '#3b82f6',
  done: '#22c55e',
  failed: '#ef4444',
  cancelled: '#6b7280',
};

function StatusBadge({ status }: { status: string }) {
  const bg = STATUS_COLORS[status] || '#6b7280';
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      background: `${bg}18`,
      color: bg,
    }}>
      {status}
    </span>
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function AddProfileModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (url: string, name: string) => void;
}) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  if (!open) return null;

  const handleSubmit = () => {
    setError('');
    try {
      new URL(url);
    } catch {
      setError('Please enter a valid URL');
      return;
    }
    onSubmit(url, name);
    setUrl('');
    setName('');
    onClose();
  };

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h3>New Profile Crawl</h3>
          <button className="admin-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="admin-modal-body">
          <div className="admin-form-group">
            <label>Profile URL *</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://shopmy.us/drconnieyang"
              autoFocus
            />
            <span className="admin-form-hint">
              A creator/curator profile or link-in-bio page (shopmy.us, ltk.app,
              linktree, Instagram bio link, Amazon storefront, etc.). The agent
              extracts every product link on the page — across all linked-out brands.
            </span>
          </div>
          <div className="admin-form-group">
            <label>Curator Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Dr. Connie Yang (optional)"
            />
          </div>
          {error && <div className="admin-form-error">{error}</div>}
        </div>
        <div className="admin-modal-footer">
          <button className="admin-btn admin-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="admin-btn admin-btn-primary" onClick={handleSubmit}>Start Crawl</button>
        </div>
      </div>
    </div>
  );
}

export default function ProfileCrawlsPanel() {
  const [jobs, setJobs] = useState<CrawlJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listCrawlJobs({ jobType: 'profile' });
      setJobs(data);
    } catch (e) {
      console.error('Failed to load profile crawls:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAdd = async (url: string, name: string) => {
    try {
      const job = await createProfileCrawlJob(url, name || undefined);
      await triggerProfileCrawl(job.id, url, name || undefined);
      loadData();
    } catch (e) {
      console.error('Failed to create profile crawl:', e);
      alert(`Failed: ${(e as Error).message}`);
    }
  };

  const handleRetry = async (job: CrawlJob) => {
    setBusyId(job.id);
    try {
      await retryCrawlJob(job.id);
      await triggerProfileCrawl(job.id, job.site_url, job.site_name || undefined);
      loadData();
    } catch (e) {
      console.error('Retry failed:', e);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (job: CrawlJob) => {
    if (!confirm(`Delete profile crawl for ${job.site_name || job.site_url}? This will also delete its discovered URLs.`)) return;
    setBusyId(job.id);
    try {
      await deleteCrawlJob(job.id);
      loadData();
    } catch (e) {
      console.error('Delete failed:', e);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p className="admin-page-subtitle" style={{ margin: 0 }}>
          Crawl a creator/curator profile (e.g. shopmy.us/drconnieyang) and ingest every
          product they’ve linked, across all brands.
        </p>
        <button className="admin-btn admin-btn-primary" onClick={() => setShowAdd(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Profile Crawl
        </button>
      </div>

      {loading ? (
        <div className="admin-empty">Loading profiles...</div>
      ) : jobs.length === 0 ? (
        <div className="admin-empty">
          No profile crawls yet. Click “New Profile Crawl” to add one.
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Curator</th>
                <th>Profile URL</th>
                <th>Status</th>
                <th>Products Found</th>
                <th>Started</th>
                <th>Completed</th>
                <th style={{ width: 140 }}></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td style={{ fontWeight: 500 }}>{j.site_name || '—'}</td>
                  <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <a
                      href={j.site_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#3b82f6', textDecoration: 'none', fontSize: 12 }}
                    >
                      {j.site_url}
                    </a>
                  </td>
                  <td>
                    <StatusBadge status={j.status} />
                    {j.error && (
                      <div style={{ fontSize: 11, color: '#dc2626', marginTop: 2, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={j.error}>
                        {j.error}
                      </div>
                    )}
                  </td>
                  <td>{j.total_urls || 0}</td>
                  <td className="admin-cell-muted">{timeAgo(j.started_at)}</td>
                  <td className="admin-cell-muted">{timeAgo(j.completed_at)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {(j.status === 'failed' || j.status === 'done' || j.status === 'cancelled') && (
                        <button
                          className="admin-btn admin-btn-secondary"
                          disabled={busyId === j.id}
                          onClick={() => handleRetry(j)}
                          style={{ fontSize: 11, padding: '3px 8px' }}
                        >
                          {busyId === j.id ? '…' : '↺ Retry'}
                        </button>
                      )}
                      <button
                        className="admin-btn admin-btn-secondary"
                        disabled={busyId === j.id}
                        onClick={() => handleDelete(j)}
                        style={{ fontSize: 11, padding: '3px 8px', color: '#dc2626' }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddProfileModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSubmit={handleAdd}
      />
    </>
  );
}
