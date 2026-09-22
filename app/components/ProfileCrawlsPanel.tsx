import { Fragment, useState, useEffect, useCallback } from 'react';
import { catalogAlert, catalogConfirm } from '~/components/CatalogDialog';
import {
  listCrawlJobs,
  createProfileCrawlJob,
  triggerProfileCrawl,
  deleteCrawlJob,
  retryCrawlJob,
  type CrawlJob,
} from '~/services/site-crawls';
import JobProgress from '~/components/JobProgress';
import CrawlProductsRow from '~/components/admin/CrawlProductsRow';
import RerunAllStuckButton from '~/components/RerunAllStuckButton';
import ShopMyIngest from '~/components/ShopMyIngest';
import { isStuck } from '~/utils/aiBudget';

// Typical wall-clock for a profile crawl (single shopmy/ltk/linktree
// page → enumerate every product link). Past 2x this we flag as stuck.
const ESTIMATED_PROFILE_CRAWL_SECONDS = 300;

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
  if (!iso) return ' - ';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** ShopMy publishes a JSON API, so it never needs the AI crawl. */
export function isShopMyUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'shopmy.us' || host === 'shop.my';
  } catch {
    return false;
  }
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
              extracts every product link on the page - across all linked-out brands.
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
  // Job whose ingested-products panel is open (one at a time).
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Set once the operator submits a ShopMy URL; hands off to <ShopMyIngest>,
  // which owns preview, confirm, progress and the write.
  const [shopMyUrl, setShopMyUrl] = useState<string | null>(null);

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

  // Poll loop for a running job's row. A silent refresh (no `loading` flip)
  // so the table doesn't flash to the "Loading…" state on every tick —
  // matches ProductCrawlsPanel's refreshSilent. Only runs while something
  // is actually pending/crawling, so an idle admin tab doesn't poll forever.
  const refreshSilent = useCallback(async () => {
    try {
      const data = await listCrawlJobs({ jobType: 'profile' });
      setJobs(data);
    } catch {
      // ignore - next tick will retry
    }
  }, []);

  useEffect(() => {
    const active = jobs.some((j) => j.status === 'pending' || j.status === 'crawling');
    if (!active) return;
    const t = setInterval(() => { void refreshSilent(); }, 5_000);
    return () => clearInterval(t);
  }, [jobs, refreshSilent]);

  const handleAdd = async (url: string, name: string) => {
    if (isShopMyUrl(url)) {
      setShopMyUrl(url);   // hand off to <ShopMyIngest>; it owns preview + confirm
      return;
    }

    try {
      const job = await createProfileCrawlJob(url, name || undefined);
      await triggerProfileCrawl(job.id, url, name || undefined);
      loadData();
    } catch (e) {
      console.error('Failed to create profile crawl:', e);
      void catalogAlert({ title: 'Crawl failed', message: (e as Error).message });
    }
  };

  const handleRetry = async (job: CrawlJob) => {
    // A ShopMy row must never be retried through the AI crawler — that's
    // the expensive path this feature exists to avoid.
    if (isShopMyUrl(job.site_url)) {
      setShopMyUrl(job.site_url);
      return;
    }
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
    if (!(await catalogConfirm({ title: `Delete profile crawl for ${job.site_name || job.site_url}?`, message: 'This will also delete its discovered URLs.', danger: true }))) return;
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 8 }}>
        <p className="admin-page-subtitle" style={{ margin: 0 }}>
          Crawl a creator/curator profile (e.g. shopmy.us/drconnieyang) and ingest every
          product they’ve linked, across all brands.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <RerunAllStuckButton
            stuckCount={jobs.filter(j => (j.status === 'pending' || j.status === 'crawling') && isStuck(j.created_at, ESTIMATED_PROFILE_CRAWL_SECONDS)).length}
            onRerunAll={async () => {
              const stuck = jobs.filter(j => (j.status === 'pending' || j.status === 'crawling') && isStuck(j.created_at, ESTIMATED_PROFILE_CRAWL_SECONDS));
              for (const j of stuck) {
                try { await handleRetry(j); } catch (e) { console.warn('rerun failed', j.id, e); }
              }
            }}
          />
          <button className="admin-btn admin-btn-primary" onClick={() => setShowAdd(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Profile Crawl
          </button>
        </div>
      </div>

      {shopMyUrl && (
        <ShopMyIngest
          // Force a fresh instance per URL — without this, retrying a
          // second ShopMy row while the panel is open reuses the prior
          // instance's job/landed/timer state (React only remounts on a
          // key change, not a prop change).
          key={shopMyUrl}
          url={shopMyUrl}
          onClose={() => { setShopMyUrl(null); loadData(); }}
          onDone={loadData}
        />
      )}

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
                <Fragment key={j.id}>
                <tr>
                  <td style={{ fontWeight: 500 }}>{j.site_name || ' - '}</td>
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
                    {(j.status === 'pending' || j.status === 'crawling') ? (
                      <JobProgress
                        status={j.status}
                        startedAt={j.started_at}
                        createdAt={j.created_at}
                        estimatedSeconds={ESTIMATED_PROFILE_CRAWL_SECONDS}
                        isQueued={j.status === 'pending' && !j.started_at}
                        onRerun={() => handleRetry(j)}
                        rerunning={busyId === j.id}
                      />
                    ) : (
                      <StatusBadge status={j.status} />
                    )}
                    {j.error && (
                      <div style={{ fontSize: 11, color: '#dc2626', marginTop: 2, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={j.error}>
                        {j.error}
                      </div>
                    )}
                  </td>
                  <td>
                    {/* Click to drop down the products this crawl ingested. */}
                    <button
                      type="button"
                      className="admin-recrawl-expand"
                      onClick={() => setExpandedId(prev => (prev === j.id ? null : j.id))}
                      aria-expanded={expandedId === j.id}
                      title={expandedId === j.id ? 'Hide ingested products' : 'Show ingested products'}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: 0, background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', font: 'inherit' }}
                    >
                      <svg
                        width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                        style={{ transform: expandedId === j.id ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease', opacity: 0.6 }}
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      {j.total_urls || 0}
                    </button>
                  </td>
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
                {expandedId === j.id && <CrawlProductsRow job={j} colSpan={7} />}
                </Fragment>
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
