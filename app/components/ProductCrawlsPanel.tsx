import { useState, useEffect, useCallback } from 'react';
import { listScrapedProducts, deleteScrapedProduct } from '~/services/scrape-product';

interface ProductRow {
  name: string;
  created_at: string;
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

function AddProductModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (url: string) => void;
}) {
  const [url, setUrl] = useState('');
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
    onSubmit(url);
    setUrl('');
    onClose();
  };

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h3>Scrape Product</h3>
          <button className="admin-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="admin-modal-body">
          <div className="admin-form-group">
            <label>Product URL *</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.example.com/products/jacket"
              autoFocus
            />
            <span className="admin-form-hint">Direct URL to a single product page</span>
          </div>
          {error && <div className="admin-form-error">{error}</div>}
        </div>
        <div className="admin-modal-footer">
          <button className="admin-btn admin-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="admin-btn admin-btn-primary" onClick={handleSubmit}>Scrape</button>
        </div>
      </div>
    </div>
  );
}

export default function ProductCrawlsPanel() {
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const items = await listScrapedProducts('products');
      setRows(items as ProductRow[]);
    } catch (e) {
      console.error('Failed to load scraped products:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAdd = async (url: string) => {
    setNotice(
      `Queued: ${url}. Scraping runs via the Python agent at agents/product-scraper. Run it manually or via Modal to complete the scrape.`
    );
    setTimeout(() => setNotice(null), 8000);
  };

  const handleDelete = async (path: string) => {
    if (!confirm(`Delete scraped product "${path}"?`)) return;
    setActionLoading(path);
    try {
      await deleteScrapedProduct(`products/${path}`);
      setRows((prev) => prev.filter((r) => r.name !== path));
    } catch (e) {
      console.error('Failed to delete:', e);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p className="admin-page-subtitle" style={{ margin: 0 }}>
          Scrape individual product pages to extract title, images, price, and variants.
        </p>
        <button className="admin-btn admin-btn-primary" onClick={() => setShowAdd(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Product Scrape
        </button>
      </div>

      {notice && (
        <div style={{
          background: 'rgba(59, 130, 246, 0.1)',
          border: '1px solid rgba(59, 130, 246, 0.25)',
          color: '#3b82f6',
          padding: '10px 14px',
          borderRadius: 6,
          fontSize: 13,
          marginBottom: 16,
        }}>
          {notice}
        </div>
      )}

      {loading ? (
        <div className="admin-empty">Loading scraped products...</div>
      ) : rows.length === 0 ? (
        <div className="admin-empty">
          No scraped products yet. Click "New Product Scrape" to add one.
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Scraped</th>
                <th style={{ width: 80 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td style={{ fontWeight: 500 }}>{r.name}</td>
                  <td className="admin-cell-muted">{timeAgo(r.created_at)}</td>
                  <td>
                    <button
                      className="admin-icon-btn"
                      title="Delete"
                      disabled={actionLoading === r.name}
                      onClick={() => handleDelete(r.name)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddProductModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSubmit={handleAdd}
      />
    </>
  );
}
