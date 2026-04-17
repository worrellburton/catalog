import { useState, useEffect, useCallback } from 'react';
import {
  listCrawlJobs,
  createCrawlJob,
  deleteCrawlJob,
  cancelCrawlJob,
  retryCrawlJob,
  triggerCrawl,
  listDiscoveredUrls,
  type CrawlJob,
  type CrawlDiscoveredUrl,
} from '~/services/site-crawls';

// ─── Status badge ────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: '#f59e0b',
    crawling: '#3b82f6',
    done: '#22c55e',
    failed: '#ef4444',
    cancelled: '#6b7280',
    queued: '#8b5cf6',
    scraped: '#22c55e',
    skipped: '#94a3b8',
  };
  const bg = colors[status] || '#6b7280';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        background: `${bg}18`,
        color: bg,
      }}
    >
      {status}
    </span>
  );
}

// ─── Time formatter ──────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ─── Add Crawl Modal ─────────────────────────────────────────────────

function AddCrawlModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (url: string, name: string, maxPages: number) => void;
}) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [maxPages, setMaxPages] = useState(100);
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
    onSubmit(url, name, maxPages);
    setUrl('');
    setName('');
    setMaxPages(100);
    onClose();
  };

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h3>New Site Crawl</h3>
          <button className="admin-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="admin-modal-body">
          <div className="admin-form-group">
            <label>Site URL *</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.example.com"
              autoFocus
            />
          </div>
          <div className="admin-form-group">
            <label>Site Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Nike US (optional)"
            />
          </div>
          <div className="admin-form-group">
            <label>Max Pages</label>
            <input
              type="number"
              value={maxPages}
              onChange={(e) => setMaxPages(Number(e.target.value))}
              min={1}
              max={500}
            />
            <span className="admin-form-hint">Maximum collection/category pages to visit</span>
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

// ─── Discovered URLs panel ───────────────────────────────────────────

function DiscoveredUrlsPanel({
  job,
  onClose,
}: {
  job: CrawlJob;
  onClose: () => void;
}) {
  const [urls, setUrls] = useState<CrawlDiscoveredUrl[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    loadUrls();
  }, [job.id, filter]);

  const loadUrls = async () => {
    setLoading(true);
    try {
      const result = await listDiscoveredUrls(job.id, {
        status: filter || undefined,
        limit: 200,
      });
      setUrls(result.data);
      setCount(result.count);
    } catch (e) {
      console.error('Failed to load URLs:', e);
    } finally {
      setLoading(false);
    }
  };

  // Group by collection
  const collections = urls.reduce<Record<string, CrawlDiscoveredUrl[]>>((acc, u) => {
    const key = u.collection_name || 'Uncategorized';
    (acc[key] = acc[key] || []).push(u);
    return acc;
  }, {});

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal admin-modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <div>
            <h3>Discovered URLs</h3>
            <p style={{ fontSize: 12, color: '#888', margin: '4px 0 0' }}>
              {job.site_name || job.site_url} — {count} URLs
            </p>
          </div>
          <button className="admin-modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '0 20px', marginBottom: 12 }}>
          {['', 'pending', 'queued', 'scraped', 'skipped', 'failed'].map((s) => (
            <button
              key={s}
              className={`admin-tab admin-tab-sub ${filter === s ? 'active' : ''}`}
              onClick={() => setFilter(s)}
              style={{ fontSize: 11, padding: '4px 10px' }}
            >
              {s || 'All'}
            </button>
          ))}
        </div>

        <div className="admin-modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {loading ? (
            <div className="admin-empty">Loading...</div>
          ) : urls.length === 0 ? (
            <div className="admin-empty">No URLs found</div>
          ) : (
            Object.entries(collections).sort(([a], [b]) => a.localeCompare(b)).map(([coll, items]) => (
              <div key={coll} style={{ marginBottom: 16 }}>
                <div style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  color: '#888',
                  marginBottom: 6,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}>
                  {coll}
                  <span style={{
                    background: '#f0f0f0',
                    borderRadius: 10,
                    padding: '1px 6px',
                    fontSize: 10,
                    fontWeight: 500,
                  }}>
                    {items.length}
                  </span>
                </div>
                <div className="admin-table-wrap" style={{ marginBottom: 0 }}>
                  <table className="admin-table" style={{ fontSize: 12 }}>
                    <tbody>
                      {items.map((u) => (
                        <tr key={u.id}>
                          <td style={{ maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <a
                              href={u.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: '#3b82f6', textDecoration: 'none' }}
                            >
                              {u.page_title || u.url}
                            </a>
                          </td>
                          <td style={{ width: 80 }}>
                            <StatusBadge status={u.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="admin-modal-footer">
          <span style={{ fontSize: 12, color: '#888' }}>
            Showing {urls.length} of {count} URLs
          </span>
          <button className="admin-btn admin-btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────

export default function SiteCrawlsPage() {
  const [jobs, setJobs] = useState<CrawlJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedJob, setSelectedJob] = useState<CrawlJob | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      const data = await listCrawlJobs();
      setJobs(data);
    } catch (e) {
      console.error('Failed to load crawl jobs:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
    // Auto-refresh every 15s for active crawls
    const interval = setInterval(loadJobs, 15_000);
    return () => clearInterval(interval);
  }, [loadJobs]);

  const handleAdd = async (url: string, name: string, maxPages: number) => {
    try {
      const job = await createCrawlJob(url, name || undefined);
      // Trigger Modal webhook
      await triggerCrawl(job.id, url, maxPages);
      loadJobs();
    } catch (e) {
      console.error('Failed to create crawl:', e);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this crawl job and all discovered URLs?')) return;
    setActionLoading(id);
    try {
      await deleteCrawlJob(id);
      setJobs((prev) => prev.filter((j) => j.id !== id));
    } catch (e) {
      console.error('Failed to delete:', e);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (id: string) => {
    setActionLoading(id);
    try {
      await cancelCrawlJob(id);
      loadJobs();
    } catch (e) {
      console.error('Failed to cancel:', e);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRetry = async (id: string, siteUrl: string) => {
    setActionLoading(id);
    try {
      await retryCrawlJob(id);
      await triggerCrawl(id, siteUrl);
      loadJobs();
    } catch (e) {
      console.error('Failed to retry:', e);
    } finally {
      setActionLoading(null);
    }
  };

  // Stats
  const stats = {
    total: jobs.length,
    active: jobs.filter((j) => j.status === 'crawling').length,
    completed: jobs.filter((j) => j.status === 'done').length,
    totalUrls: jobs.reduce((sum, j) => sum + (j.total_urls || 0), 0),
  };

  return (
    <div className="admin-page">
      <div className="admin-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Site Crawls</h1>
          <p className="admin-page-subtitle">Crawl e-commerce sites to discover product URLs</p>
        </div>
        <button className="admin-btn admin-btn-primary" onClick={() => setShowAdd(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Crawl
        </button>
      </div>

      {/* Stats */}
      <div className="admin-stats-grid">
        <div className="admin-stat-card">
          <div className="admin-stat-value">{stats.total}</div>
          <div className="admin-stat-label">Total Crawls</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-value">{stats.active}</div>
          <div className="admin-stat-label">Active</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-value">{stats.completed}</div>
          <div className="admin-stat-label">Completed</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-value">{stats.totalUrls.toLocaleString()}</div>
          <div className="admin-stat-label">URLs Discovered</div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="admin-empty">Loading crawl jobs...</div>
      ) : jobs.length === 0 ? (
        <div className="admin-empty">
          No crawl jobs yet. Click "New Crawl" to get started.
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Site</th>
                <th>Status</th>
                <th>URLs Found</th>
                <th>Queued</th>
                <th>Started</th>
                <th>Duration</th>
                <th style={{ width: 120 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const duration =
                  job.started_at && job.completed_at
                    ? Math.round((new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000)
                    : null;
                const isActive = job.status === 'pending' || job.status === 'crawling';

                return (
                  <tr key={job.id}>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontWeight: 500 }}>{job.site_name || '—'}</span>
                        <a
                          href={job.site_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: 11, color: '#888', textDecoration: 'none' }}
                        >
                          {job.site_url}
                        </a>
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={job.status} />
                      {job.error && (
                        <div style={{ fontSize: 11, color: '#ef4444', marginTop: 2, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {job.error}
                        </div>
                      )}
                    </td>
                    <td>
                      {job.total_urls > 0 ? (
                        <button
                          className="admin-link-btn"
                          onClick={() => setSelectedJob(job)}
                          style={{ color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500, fontSize: 13 }}
                        >
                          {job.total_urls}
                        </button>
                      ) : (
                        <span className="admin-cell-muted">—</span>
                      )}
                    </td>
                    <td>
                      {job.scraped_urls > 0 ? (
                        <span>{job.scraped_urls} / {job.total_urls}</span>
                      ) : (
                        <span className="admin-cell-muted">—</span>
                      )}
                    </td>
                    <td className="admin-cell-muted">{timeAgo(job.created_at)}</td>
                    <td className="admin-cell-muted">
                      {duration !== null
                        ? duration < 60
                          ? `${duration}s`
                          : `${Math.floor(duration / 60)}m ${duration % 60}s`
                        : isActive
                          ? '...'
                          : '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {job.status === 'failed' && (
                          <button
                            className="admin-icon-btn"
                            title="Retry"
                            disabled={actionLoading === job.id}
                            onClick={() => handleRetry(job.id, job.site_url)}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                            </svg>
                          </button>
                        )}
                        {isActive && (
                          <button
                            className="admin-icon-btn"
                            title="Cancel"
                            disabled={actionLoading === job.id}
                            onClick={() => handleCancel(job.id)}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                            </svg>
                          </button>
                        )}
                        <button
                          className="admin-icon-btn"
                          title="Delete"
                          disabled={actionLoading === job.id}
                          onClick={() => handleDelete(job.id)}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
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

      {/* Modals */}
      <AddCrawlModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSubmit={handleAdd}
      />

      {selectedJob && (
        <DiscoveredUrlsPanel
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
        />
      )}
    </div>
  );
}
