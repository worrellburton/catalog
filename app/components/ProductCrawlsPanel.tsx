import { useState, useEffect, useCallback } from 'react';
import { listProducts, retryProductScrape, addProductUrl, deleteProduct, type ProductRow } from '~/services/scrape-product';

const STATUS_FILTERS = ['all', 'done', 'pending', 'processing', 'failed'] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

const STATUS_STYLES: Record<string, { color: string; background: string; label: string }> = {
  done:       { color: '#16a34a', background: 'rgba(22,163,74,0.1)',   label: 'DONE' },
  pending:    { color: '#b45309', background: 'rgba(180,83,9,0.1)',    label: 'PENDING' },
  processing: { color: '#1d4ed8', background: 'rgba(29,78,216,0.1)',   label: 'PROCESSING' },
  failed:     { color: '#dc2626', background: 'rgba(220,38,38,0.1)',   label: 'FAILED' },
};

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

function ErrorTooltip({ error }: { error: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <span
      style={{ position: 'relative', display: 'inline-block', marginTop: 2 }}
      onMouseEnter={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setPos(null)}
    >
      <span style={{
        color: '#dc2626',
        fontSize: 11,
        fontWeight: 600,
        cursor: 'default',
        borderBottom: '1px dashed #dc2626',
      }}>
        Error
      </span>
      {pos && (
        <div style={{
          position: 'fixed',
          top: pos.y - 8,
          left: pos.x + 12,
          zIndex: 9999,
          background: '#1f2937',
          color: '#f9fafb',
          padding: '10px 14px',
          borderRadius: 6,
          fontSize: 12,
          minWidth: 250,
          maxWidth: 360,
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          pointerEvents: 'none',
          lineHeight: 1.6,
          transform: 'translateY(-100%)',
        }}>
          {error}
        </div>
      )}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? { color: '#6b7280', background: 'rgba(107,114,128,0.1)', label: status.toUpperCase() };
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: '0.04em',
      color: s.color,
      background: s.background,
    }}>
      {s.label}
    </span>
  );
}

const PAGE_SIZE = 50;

export default function ProductCrawlsPanel() {
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(0);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [addingUrl, setAddingUrl] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data, count } = await listProducts({
        status: statusFilter,
        search: search || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setRows(data);
      setTotal(count);
    } catch (e) {
      console.error('Failed to load products:', e);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search, page]);

  // Silent background refresh — no loading spinner, only updates existing rows.
  // Used by the auto-poll loop so status changes appear without a full reload.
  const refreshSilent = useCallback(async () => {
    try {
      const { data, count } = await listProducts({
        status: statusFilter,
        search: search || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setRows(data);
      setTotal(count);
    } catch {
      // ignore — next tick will retry
    }
  }, [statusFilter, search, page]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-poll every 5 s while any row is pending or processing.
  useEffect(() => {
    const hasActive = rows.some(
      (r) => r.scrape_status === 'pending' || r.scrape_status === 'processing',
    );
    if (!hasActive) return;
    const timer = setInterval(refreshSilent, 5_000);
    return () => clearInterval(timer);
  }, [rows, refreshSilent]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    setSearch(searchInput);
  };

  const handleStatusFilter = (s: StatusFilter) => {
    setPage(0);
    setStatusFilter(s);
  };

  const handleAddUrl = async () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    setAddingUrl(true);
    setAddError(null);
    try {
      const newRow = await addProductUrl(trimmed);
      setUrlInput('');
      setRows((prev) => [newRow, ...prev]);
      setTotal((t) => t + 1);
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : 'Failed to add URL');
    } finally {
      setAddingUrl(false);
    }
  };

  const handleAddUrlKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleAddUrl();
  };

  const handleRetry = async (id: string) => {
    setRetrying(id);
    try {
      await retryProductScrape(id);
      setRows((prev) =>
        prev.map((r) => r.id === id ? { ...r, scrape_status: 'pending', scrape_error: null, scraped_at: null } : r)
      );
    } catch (e) {
      console.error('Failed to retry scrape:', e);
    } finally {
      setRetrying(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this product and all associated ads? This cannot be undone.')) return;
    setDeleting(id);
    try {
      await deleteProduct(id);
      setRows((prev) => prev.filter((r) => r.id !== id));
      setTotal((t) => t - 1);
    } catch (e) {
      console.error('Failed to delete product:', e);
    } finally {
      setDeleting(null);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <p className="admin-page-subtitle" style={{ margin: 0 }}>
          All products indexed by the site crawler and product scraper agents.
        </p>
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search products…"
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 13, minWidth: 200 }}
          />
          <button type="submit" className="admin-btn admin-btn-secondary">Search</button>
        </form>
      </div>

      {/* Add product URL */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="url"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={handleAddUrlKeyDown}
          placeholder="Paste a product URL to scrape…"
          style={{ flex: 1, minWidth: 260, padding: '6px 10px', borderRadius: 6, border: `1px solid ${addError ? '#dc2626' : '#e5e7eb'}`, fontSize: 13 }}
        />
        <button
          className="admin-btn admin-btn-primary"
          disabled={addingUrl || !urlInput.trim()}
          onClick={handleAddUrl}
          style={{ whiteSpace: 'nowrap' }}
        >
          {addingUrl ? 'Adding…' : '+ Add URL'}
        </button>
        {addError && (
          <span style={{ fontSize: 12, color: '#dc2626', width: '100%' }}>{addError}</span>
        )}
      </div>

      {/* Status filter tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => handleStatusFilter(s)}
            style={{
              padding: '4px 12px',
              borderRadius: 6,
              border: statusFilter === s ? '1px solid #1d4ed8' : '1px solid #e5e7eb',
              background: statusFilter === s ? '#1d4ed8' : 'transparent',
              color: statusFilter === s ? '#fff' : '#374151',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {s}
          </button>
        ))}
        {total > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#6b7280', alignSelf: 'center' }}>
            {total.toLocaleString()} product{total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {loading ? (
        <div className="admin-empty">Loading products…</div>
      ) : rows.length === 0 ? (
        <div className="admin-empty">No products found.</div>
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}></th>
                  <th>Product</th>
                  <th>URL</th>
                  <th>Brand</th>
                  <th>Price</th>
                  <th>Status</th>
                  <th>Scraped</th>
                  <th>Added</th>
                  <th style={{ width: 120 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {(() => {
                        const thumb = r.image_url || (Array.isArray(r.images) && r.images.length > 0 ? r.images[0] : null);
                        if (thumb) {
                          return (
                            <img
                              src={thumb}
                              alt=""
                              style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4, display: 'block' }}
                            />
                          );
                        }
                        const reason = r.image_missing_reason;
                        return (
                          <div
                            title={reason || 'No image available'}
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 4,
                              background: '#fef2f2',
                              border: '1px solid #fecaca',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: reason ? 'help' : 'default',
                              flexShrink: 0,
                            }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                              <circle cx="8.5" cy="8.5" r="1.5"/>
                              <polyline points="21 15 16 10 5 21"/>
                            </svg>
                          </div>
                        );
                      })()}
                    </td>
                    <td style={{ fontWeight: 500, maxWidth: 220 }}>
                      {r.name || <span style={{ color: '#9ca3af' }}>—</span>}
                      {r.scrape_error && <ErrorTooltip error={r.scrape_error} />}
                      {!r.image_url && !(Array.isArray(r.images) && r.images.length > 0) && r.image_missing_reason && (
                        <div style={{ fontSize: 11, color: '#f87171', marginTop: 2, fontWeight: 400, lineHeight: 1.3 }}>
                          {r.image_missing_reason}
                        </div>
                      )}
                    </td>
                    <td style={{ maxWidth: 200 }}>
                      {r.url ? (
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: 12, color: '#6b7280', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}
                          title={r.url}
                        >
                          {r.url.replace(/^https?:\/\//, '')}
                        </a>
                      ) : (
                        <span style={{ color: '#d1d5db' }}>—</span>
                      )}
                    </td>
                    <td className="admin-cell-muted">{r.brand || '—'}</td>
                    <td className="admin-cell-muted">{r.price || '—'}</td>
                    <td><StatusBadge status={r.scrape_status} /></td>
                    <td className="admin-cell-muted">{timeAgo(r.scraped_at)}</td>
                    <td className="admin-cell-muted">{timeAgo(r.created_at)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        {(r.scrape_status === 'failed' || r.scrape_status === 'pending') && (
                          <button
                            className="admin-btn admin-btn-secondary"
                            disabled={retrying === r.id}
                            onClick={() => handleRetry(r.id)}
                            style={{ fontSize: 11, padding: '3px 8px', whiteSpace: 'nowrap' }}
                            title="Reset to pending so the scraper picks it up again"
                          >
                            {retrying === r.id ? '…' : '↺ Retry'}
                          </button>
                        )}
                        {r.scrape_status === 'done' && (
                          <button
                            className="admin-btn admin-btn-secondary"
                            disabled={retrying === r.id}
                            onClick={() => handleRetry(r.id)}
                            style={{ fontSize: 11, padding: '3px 8px', whiteSpace: 'nowrap', color: '#6b7280' }}
                            title="Re-scrape this product in case the data is incorrect"
                          >
                            {retrying === r.id ? '…' : '↺ Regenerate'}
                          </button>
                        )}
                        <button
                          className="admin-btn"
                          disabled={deleting === r.id}
                          onClick={() => handleDelete(r.id)}
                          style={{
                            fontSize: 11,
                            padding: '3px 8px',
                            whiteSpace: 'nowrap',
                            color: '#dc2626',
                            border: '1px solid #fecaca',
                            background: 'transparent',
                          }}
                          title="Delete product and all associated ads"
                        >
                          {deleting === r.id ? '…' : '🗑'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
              <button
                className="admin-btn admin-btn-secondary"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                ← Prev
              </button>
              <span style={{ alignSelf: 'center', fontSize: 13, color: '#6b7280' }}>
                {page + 1} / {totalPages}
              </span>
              <button
                className="admin-btn admin-btn-secondary"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
