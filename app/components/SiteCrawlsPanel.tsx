import { Fragment, useState, useEffect, useCallback } from 'react';
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

interface SiteCrawlsPanelProps {
  embedded?: boolean;
}

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

function AddCrawlModal({
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
          <p className="admin-form-hint" style={{ marginTop: 4 }}>
            The crawler auto-detects collections, categories and products from
            the site’s sitemap and navigation — no page limit needed.
          </p>
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
    loadUrls();
  }, [job.id, filter]);

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

type AutomationFrequency = 'off' | 'hourly' | 'daily' | 'weekly' | 'monthly';

interface AutomationSettings {
  enabled: boolean;
  frequency: AutomationFrequency;
}

const AUTOMATION_STORAGE_KEY = 'catalog-crawl-automations';

function loadAutomations(): Record<string, AutomationSettings> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(AUTOMATION_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveAutomation(jobId: string, settings: AutomationSettings) {
  if (typeof window === 'undefined') return;
  const all = loadAutomations();
  all[jobId] = settings;
  localStorage.setItem(AUTOMATION_STORAGE_KEY, JSON.stringify(all));
}

function AutomationRow({
  current,
  colSpan,
  onSave,
  onClose,
}: {
  current: AutomationSettings;
  colSpan: number;
  onSave: (settings: AutomationSettings) => void;
  onClose: () => void;
}) {
  const [enabled, setEnabled] = useState(current.enabled);
  const [frequency, setFrequency] = useState<AutomationFrequency>(
    current.frequency === 'off' ? 'daily' : current.frequency
  );

  const handleSave = () => {
    onSave({ enabled, frequency: enabled ? frequency : 'off' });
    onClose();
  };

  const frequencyOptions: { value: AutomationFrequency; label: string; desc: string }[] = [
    { value: 'hourly', label: 'Hourly', desc: 'Every hour' },
    { value: 'daily', label: 'Daily', desc: 'Once a day' },
    { value: 'weekly', label: 'Weekly', desc: 'Every Monday' },
    { value: 'monthly', label: 'Monthly', desc: 'On the 1st' },
  ];

  return (
    <tr className="admin-automation-row" onClick={(e) => e.stopPropagation()}>
      <td colSpan={colSpan} style={{ padding: 0, background: '#fafafa' }}>
        <div className="admin-automation-panel">
          <div className="admin-automation-header">
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>Automated re-crawl</div>
              <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                Periodically re-run this crawl to keep data fresh
              </div>
            </div>
            <button
              type="button"
              className={`admin-toggle-btn ${enabled ? 'on' : 'off'}`}
              onClick={() => setEnabled(!enabled)}
              aria-label="Toggle automation"
            >
              <span className="admin-toggle-track">
                <span className="admin-toggle-thumb" />
              </span>
            </button>
          </div>

          {enabled && (
            <div className="admin-automation-freq">
              {frequencyOptions.map((opt) => (
                <label
                  key={opt.value}
                  className={`admin-automation-opt ${frequency === opt.value ? 'is-active' : ''}`}
                >
                  <input
                    type="radio"
                    name="frequency-inline"
                    value={opt.value}
                    checked={frequency === opt.value}
                    onChange={() => setFrequency(opt.value)}
                  />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{opt.label}</div>
                    <div style={{ fontSize: 11, color: '#888' }}>{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          )}

          <div className="admin-automation-actions">
            <button className="admin-btn admin-btn-secondary" onClick={onClose}>Cancel</button>
            <button className="admin-btn admin-btn-primary" onClick={handleSave}>Save</button>
          </div>
        </div>
      </td>
    </tr>
  );
}

const SITEMAP_DISPLAY_LIMIT = 100;

function SitemapExpandedRow({
  crawlId,
  colSpan,
}: {
  crawlId: string;
  colSpan: number;
}) {
  const [urls, setUrls] = useState<CrawlDiscoveredUrl[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadUrls = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await listDiscoveredUrls(crawlId, { limit: SITEMAP_DISPLAY_LIMIT });
        if (cancelled) return;
        setUrls(result.data);
        setCount(result.count);
      } catch (e) {
        if (cancelled) return;
        console.error('Failed to load sitemap:', e);
        setError('Failed to load sitemap');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadUrls();
    return () => {
      cancelled = true;
    };
  }, [crawlId]);

  const grouped = urls.reduce<Record<string, CrawlDiscoveredUrl[]>>((acc, u) => {
    const key = u.collection_name || 'Uncategorized';
    (acc[key] = acc[key] || []).push(u);
    return acc;
  }, {});

  const overflow = Math.max(0, count - urls.length);

  return (
    <tr className="admin-look-expanded-row open">
      <td colSpan={colSpan} style={{ padding: 0 }}>
        <div className="admin-expand-animate">
          <div className="admin-look-products">
            <h3 className="admin-products-title">
              Sitemap ({count} {count === 1 ? 'URL' : 'URLs'})
            </h3>
            {loading ? (
              <div className="admin-empty" style={{ padding: '16px 0' }}>Loading sitemap…</div>
            ) : error ? (
              <div className="admin-empty" style={{ padding: '16px 0', color: '#ef4444' }}>{error}</div>
            ) : urls.length === 0 ? (
              <div className="admin-empty" style={{ padding: '16px 0' }}>
                No URLs discovered for this crawl yet.
              </div>
            ) : (
              <>
                {Object.entries(grouped)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([group, items]) => (
                    <div key={group} style={{ marginBottom: 16 }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          color: '#888',
                          marginBottom: 6,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        {group}
                        <span
                          style={{
                            background: '#f0f0f0',
                            borderRadius: 10,
                            padding: '1px 6px',
                            fontSize: 10,
                            fontWeight: 500,
                          }}
                        >
                          {items.length}
                        </span>
                      </div>
                      <table className="admin-table admin-products-table" style={{ fontSize: 12 }}>
                        <thead>
                          <tr>
                            <th style={{ width: 40 }}>#</th>
                            <th>URL</th>
                            <th style={{ width: 100 }}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((u, idx) => (
                            <tr key={u.id}>
                              <td className="admin-cell-muted">{idx + 1}</td>
                              <td
                                style={{
                                  maxWidth: 600,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                <a
                                  href={u.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  style={{ color: '#3b82f6', textDecoration: 'none' }}
                                >
                                  {u.page_title || u.url}
                                </a>
                              </td>
                              <td>
                                <StatusBadge status={u.status} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                {overflow > 0 && (
                  <div
                    style={{
                      fontSize: 12,
                      color: '#888',
                      textAlign: 'center',
                      padding: '8px 0 4px',
                    }}
                  >
                    +{overflow} more {overflow === 1 ? 'URL' : 'URLs'} not shown
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function SiteCrawlsPanel({ embedded = false }: SiteCrawlsPanelProps) {
  const [jobs, setJobs] = useState<CrawlJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [expandedAutomationId, setExpandedAutomationId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [automations, setAutomations] = useState<Record<string, AutomationSettings>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [crawlError, setCrawlError] = useState<string | null>(null);

  useEffect(() => {
    setAutomations(loadAutomations());
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      const data = await listCrawlJobs({ jobType: 'site' });
      setJobs(data);
    } catch (e) {
      console.error('Failed to load crawl jobs:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
    const interval = setInterval(loadJobs, 15_000);
    return () => clearInterval(interval);
  }, [loadJobs]);

  const handleAdd = async (url: string, name: string) => {
    setCrawlError(null);
    try {
      const job = await createCrawlJob(url, name || undefined);
      const triggered = await triggerCrawl(job.id, url);
      if (!triggered) {
        setCrawlError('Crawl job created but the crawler could not be triggered. Check that VITE_MODAL_CRAWLER_URL is configured.');
      }
      loadJobs();
    } catch (e) {
      console.error('Failed to create crawl:', e);
      setCrawlError('Failed to create crawl job.');
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
    setCrawlError(null);
    try {
      await retryCrawlJob(id);
      const triggered = await triggerCrawl(id, siteUrl);
      if (!triggered) {
        setCrawlError('Crawl reset but the crawler could not be triggered. Check that VITE_MODAL_CRAWLER_URL is configured.');
      }
      loadJobs();
    } catch (e) {
      console.error('Failed to retry:', e);
      setCrawlError('Failed to retry crawl job.');
    } finally {
      setActionLoading(null);
    }
  };

  const stats = {
    total: jobs.length,
    active: jobs.filter((j) => j.status === 'crawling').length,
    completed: jobs.filter((j) => j.status === 'done').length,
    totalUrls: jobs.reduce((sum, j) => sum + (j.total_urls || 0), 0),
  };

  return (
    <>
      {crawlError && (
        <div
          style={{
            background: '#fef2f2',
            border: '1px solid #fca5a5',
            borderRadius: 6,
            padding: '10px 14px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            fontSize: 13,
            color: '#b91c1c',
          }}
        >
          <span>{crawlError}</span>
          <button
            onClick={() => setCrawlError(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', fontSize: 16, lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      )}

      {!embedded && (
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
      )}

      {embedded && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <button className="admin-btn admin-btn-primary" onClick={() => setShowAdd(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Crawl
          </button>
        </div>
      )}

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

      {loading ? (
        <div className="admin-empty">Loading crawl jobs...</div>
      ) : jobs.length === 0 ? (
        <div className="admin-empty">
          No crawl jobs yet. Click "New Crawl" to get started.
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table admin-table-clickable">
            <thead>
              <tr>
                <th style={{ width: 48 }}></th>
                <th>Site</th>
                <th>Status</th>
                <th>URLs Found</th>
                <th>Queued</th>
                <th>Started</th>
                <th>Last Synced</th>
                <th>Duration</th>
                <th>Total Cost</th>
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
                const lastSynced = job.completed_at || (isActive ? null : job.updated_at);
                const costPerUrl = 0.05;
                const totalCost = (job.scraped_urls || 0) * costPerUrl;
                const autoSettings = automations[job.id] || { enabled: false, frequency: 'off' as AutomationFrequency };

                return (
                  <Fragment key={job.id}>
                  <tr
                    className="admin-table-row-clickable"
                    onClick={() =>
                      setExpandedId((prev) => (prev === job.id ? null : job.id))
                    }
                    style={{ cursor: 'pointer' }}
                  >
                    <td onClick={(e) => e.stopPropagation()} style={{ width: 48 }}>
                      <button
                        className="admin-icon-btn"
                        title={autoSettings.enabled ? `Automation: ${autoSettings.frequency}` : 'Set automation'}
                        onClick={() =>
                          setExpandedAutomationId((prev) => (prev === job.id ? null : job.id))
                        }
                        style={{
                          color: autoSettings.enabled ? '#3b82f6' : 'rgba(0,0,0,0.35)',
                        }}
                      >
                        {autoSettings.enabled ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
                          </svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
                          </svg>
                        )}
                      </button>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontWeight: 500 }}>{job.site_name || '—'}</span>
                        <a
                          href={job.site_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
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
                        <span style={{ color: '#3b82f6', fontWeight: 500, fontSize: 13 }}>
                          {job.total_urls}
                        </span>
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
                      {isActive ? 'syncing…' : timeAgo(lastSynced)}
                    </td>
                    <td className="admin-cell-muted">
                      {duration !== null
                        ? duration < 60
                          ? `${duration}s`
                          : `${Math.floor(duration / 60)}m ${duration % 60}s`
                        : isActive
                          ? '...'
                          : '—'}
                    </td>
                    <td className="admin-cell-muted">
                      {job.scraped_urls > 0 ? `$${totalCost.toFixed(2)}` : '—'}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
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
                  {expandedAutomationId === job.id && (
                    <AutomationRow
                      current={autoSettings}
                      colSpan={10}
                      onClose={() => setExpandedAutomationId(null)}
                      onSave={(settings) => {
                        saveAutomation(job.id, settings);
                        setAutomations((prev) => ({ ...prev, [job.id]: settings }));
                      }}
                    />
                  )}
                  {expandedId === job.id && (
                    <SitemapExpandedRow crawlId={job.id} colSpan={10} />
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AddCrawlModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSubmit={handleAdd}
      />

    </>
  );
}
