import { useState, useEffect, useCallback } from 'react';
import {
  listCrawlJobs,
  createCrawlJob,
  deleteCrawlJob,
  triggerCrawl,
  listDiscoveredUrls,
  type CrawlJob,
  type CrawlDiscoveredUrl,
} from '~/services/site-crawls';

interface CollectionRow {
  collection_name: string;
  job: CrawlJob;
  url_count: number;
  sample_url: string;
}

function AddCollectionModal({
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
          <h3>New Collection Crawl</h3>
          <button className="admin-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="admin-modal-body">
          <div className="admin-form-group">
            <label>Collection URL *</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.example.com/collections/winter-2026"
              autoFocus
            />
            <span className="admin-form-hint">Direct URL to a single collection or category page</span>
          </div>
          <div className="admin-form-group">
            <label>Collection Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Winter 2026 (optional)"
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

export default function CollectionCrawlsPanel() {
  const [rows, setRows] = useState<CollectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const jobs = await listCrawlJobs();
      const allRows: CollectionRow[] = [];
      for (const job of jobs) {
        if (job.status !== 'done' && job.status !== 'crawling') continue;
        const { data } = await listDiscoveredUrls(job.id, { limit: 500 });
        const byCollection = data.reduce<Record<string, CrawlDiscoveredUrl[]>>((acc, u) => {
          const key = u.collection_name || 'Uncategorized';
          (acc[key] = acc[key] || []).push(u);
          return acc;
        }, {});
        for (const [collection_name, urls] of Object.entries(byCollection)) {
          if (collection_name === 'Uncategorized') continue;
          allRows.push({
            collection_name,
            job,
            url_count: urls.length,
            sample_url: urls[0]?.url || '',
          });
        }
      }
      setRows(allRows);
    } catch (e) {
      console.error('Failed to load collections:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAdd = async (url: string, name: string) => {
    try {
      const job = await createCrawlJob(url, name || undefined);
      await triggerCrawl(job.id, url, 1);
      loadData();
    } catch (e) {
      console.error('Failed to create collection crawl:', e);
    }
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p className="admin-page-subtitle" style={{ margin: 0 }}>
          Crawl a single collection or category page to pull the products inside.
        </p>
        <button className="admin-btn admin-btn-primary" onClick={() => setShowAdd(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Collection Crawl
        </button>
      </div>

      {loading ? (
        <div className="admin-empty">Loading collections...</div>
      ) : rows.length === 0 ? (
        <div className="admin-empty">
          No collections crawled yet. Click "New Collection Crawl" to add one.
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Collection</th>
                <th>Source Site</th>
                <th>Products Found</th>
                <th>Sample URL</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.job.id}-${r.collection_name}-${i}`}>
                  <td style={{ fontWeight: 500 }}>{r.collection_name}</td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span>{r.job.site_name || '—'}</span>
                      <a href={r.job.site_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#888', textDecoration: 'none' }}>
                        {r.job.site_url}
                      </a>
                    </div>
                  </td>
                  <td>{r.url_count}</td>
                  <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <a href={r.sample_url} target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6', textDecoration: 'none', fontSize: 12 }}>
                      {r.sample_url}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddCollectionModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSubmit={handleAdd}
      />
    </>
  );
}
