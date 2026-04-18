import { useState, useEffect, useCallback, Fragment } from 'react';
import { useSortableTable, SortableTh } from '~/components/SortableTable';
import {
  getProductAds,
  createBatchAds,
  regenerateAd,
  setAdLive,
  pauseAd,
  deleteProductAd,
  updateAdAffiliateUrl,
  type ProductAd,
} from '~/services/product-ads';
import { supabase } from '~/utils/supabase';

// ─── Types ───────────────────────────────────────────────────────────

interface SupabaseProduct {
  id: string;
  name: string | null;
  brand: string | null;
  price: string | null;
  image_url: string | null;
  url: string | null;
}

// ─── Styles available ────────────────────────────────────────────────

const AD_STYLES = [
  { value: 'studio_clean', label: 'Studio Clean' },
  { value: 'editorial_runway', label: 'Editorial Runway' },
  { value: 'street_style', label: 'Street Style' },
  { value: 'lifestyle_context', label: 'Lifestyle' },
];

// ─── Status badge ────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: '#f59e0b',
    generating: '#3b82f6',
    done: '#22c55e',
    failed: '#ef4444',
    live: '#10b981',
    paused: '#6b7280',
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

// ─── Time helpers ────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

// ─── Filter tabs ─────────────────────────────────────────────────────

type FilterTab = 'all' | 'live' | 'done' | 'pending' | 'failed' | 'paused';

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'done', label: 'Ready' },
  { key: 'pending', label: 'Generating' },
  { key: 'failed', label: 'Failed' },
  { key: 'paused', label: 'Paused' },
];

// ─── Main Page ───────────────────────────────────────────────────────

export default function AdminProductAds({ embedded = false }: { embedded?: boolean }) {
  const [ads, setAds] = useState<ProductAd[]>([]);
  const [products, setProducts] = useState<SupabaseProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [previewAd, setPreviewAd] = useState<ProductAd | null>(null);

  // Create modal state
  const [showCreate, setShowCreate] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [selectedStyle, setSelectedStyle] = useState('studio_clean');
  const [adCount, setAdCount] = useState(2);
  const [creating, setCreating] = useState(false);
  const [productSearch, setProductSearch] = useState('');

  // Affiliate URL edit state
  const [editingUrlId, setEditingUrlId] = useState<string | null>(null);
  const [editingUrlValue, setEditingUrlValue] = useState('');

  const loadAds = useCallback(async () => {
    setLoading(true);
    const data = await getProductAds();
    setAds(data);
    setLoading(false);
  }, []);

  const loadProducts = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from('products')
      .select('id, name, brand, price, image_url, url')
      .order('name');
    if (data) setProducts(data);
  }, []);

  useEffect(() => { loadAds(); loadProducts(); }, [loadAds, loadProducts]);

  // Auto-refresh if active jobs
  useEffect(() => {
    const hasActive = ads.some(a => a.status === 'pending' || a.status === 'generating');
    if (!hasActive) return;
    const interval = setInterval(loadAds, 15_000);
    return () => clearInterval(interval);
  }, [ads, loadAds]);

  const filtered = activeTab === 'all'
    ? ads
    : activeTab === 'pending'
      ? ads.filter(a => a.status === 'pending' || a.status === 'generating')
      : ads.filter(a => a.status === activeTab);

  const { sortedData, sort, handleSort } = useSortableTable(filtered);

  // Actions
  const handleRegenerate = async (id: string) => {
    await regenerateAd(id);
    loadAds();
  };

  const handleSetLive = async (id: string) => {
    await setAdLive(id);
    loadAds();
  };

  const handlePause = async (id: string) => {
    await pauseAd(id);
    loadAds();
  };

  const handleDelete = async (id: string) => {
    await deleteProductAd(id);
    loadAds();
  };

  const handleSaveUrl = async (id: string) => {
    await updateAdAffiliateUrl(id, editingUrlValue);
    setEditingUrlId(null);
    loadAds();
  };

  const handleCreateAds = async () => {
    if (selectedProducts.size === 0) return;
    setCreating(true);
    const { error } = await createBatchAds(
      Array.from(selectedProducts),
      selectedStyle,
      adCount,
    );
    setCreating(false);
    if (!error) {
      setShowCreate(false);
      setSelectedProducts(new Set());
      loadAds();
    }
  };

  const toggleProductSelection = (id: string) => {
    setSelectedProducts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const filteredProducts = productSearch
    ? products.filter(p =>
        (p.name || '').toLowerCase().includes(productSearch.toLowerCase()) ||
        (p.brand || '').toLowerCase().includes(productSearch.toLowerCase())
      )
    : products;

  // Stats
  const liveCount = ads.filter(a => a.status === 'live').length;
  const totalImpressions = ads.reduce((s, a) => s + (a.impressions || 0), 0);
  const totalClicks = ads.reduce((s, a) => s + (a.clicks || 0), 0);
  const totalCost = ads.reduce((s, a) => s + (a.cost_usd || 0), 0);

  const stats = [
    { label: 'Total Ads', value: String(ads.length) },
    { label: 'Live', value: String(liveCount) },
    { label: 'Impressions', value: totalImpressions.toLocaleString() },
    { label: 'Clicks', value: totalClicks.toLocaleString() },
    { label: 'CTR', value: totalImpressions > 0 ? `${((totalClicks / totalImpressions) * 100).toFixed(1)}%` : '—' },
    { label: 'Total Cost', value: `$${totalCost.toFixed(2)}` },
  ];

  return (
    <div className={embedded ? '' : 'admin-page'}>
      {!embedded ? (
        <div className="admin-page-header">
          <div>
            <h1>Product Ads</h1>
            <p className="admin-page-subtitle">Generate and manage AI video ads for products</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="admin-btn admin-btn-secondary" onClick={loadAds} disabled={loading}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              Refresh
            </button>
            <button className="admin-btn admin-btn-primary" onClick={() => setShowCreate(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Generate Videos
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <p className="admin-page-subtitle" style={{ margin: 0 }}>Generate and manage AI video ads for products</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="admin-btn admin-btn-secondary" onClick={loadAds} disabled={loading}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              Refresh
            </button>
            <button className="admin-btn admin-btn-primary" onClick={() => setShowCreate(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Generate Videos
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="admin-stats-grid">
        {stats.map(s => (
          <div key={s.label} className="admin-stat-card">
            <span className="admin-stat-value">{s.value}</span>
            <span className="admin-stat-label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="admin-tabs" style={{ marginBottom: 16 }}>
        {FILTER_TABS.map(tab => {
          const count = tab.key === 'all'
            ? ads.length
            : tab.key === 'pending'
              ? ads.filter(a => a.status === 'pending' || a.status === 'generating').length
              : ads.filter(a => a.status === tab.key).length;
          return (
            <button
              key={tab.key}
              className={`admin-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
              <span className="admin-tab-badge">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Table */}
      {loading ? (
        <div className="admin-empty">Loading product ads…</div>
      ) : filtered.length === 0 ? (
        <div className="admin-empty">
          No ads {activeTab !== 'all' ? `with status "${activeTab}"` : 'yet'}.
          <br />
          <button
            className="admin-btn admin-btn-primary"
            style={{ marginTop: 12 }}
            onClick={() => setShowCreate(true)}
          >
            Generate your first ads
          </button>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>Preview</th>
                <th>Type</th>
                <SortableTh label="Product" sortKey="product" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Style" sortKey="style" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Status" sortKey="status" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Impressions" sortKey="impressions" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Clicks" sortKey="clicks" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Created" sortKey="created_at" currentSort={sort} onSort={handleSort} />
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedData.map(ad => {
                const isExpanded = expandedId === ad.id;
                return (
                  <Fragment key={ad.id}>
                    <tr
                      className="admin-clickable-row"
                      onClick={() => setExpandedId(prev => prev === ad.id ? null : ad.id)}
                    >
                      {/* Video thumbnail */}
                      <td>
                        {ad.video_url ? (
                          <div
                            style={{
                              width: 48, height: 64, borderRadius: 6, overflow: 'hidden',
                              background: '#111', cursor: 'pointer', position: 'relative',
                            }}
                            onClick={e => { e.stopPropagation(); setPreviewAd(ad); }}
                          >
                            <video
                              src={ad.video_url}
                              muted playsInline preload="metadata"
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                            <div style={{
                              position: 'absolute', inset: 0, display: 'flex',
                              alignItems: 'center', justifyContent: 'center',
                              background: 'rgba(0,0,0,0.3)',
                            }}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                            </div>
                          </div>
                        ) : (
                          <div style={{
                            width: 48, height: 64, borderRadius: 6,
                            background: '#f5f5f5', display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            fontSize: 10, color: '#999',
                          }}>
                            {ad.status === 'failed' ? '✕' : '…'}
                          </div>
                        )}
                      </td>

                      {/* Type */}
                      <td>
                        <span className={`admin-connection-pill admin-connection-${ad.look_id ? 'look' : 'ad'}`}>
                          {ad.look_id ? 'Look' : 'Product'}
                        </span>
                      </td>

                      {/* Product */}
                      <td className="admin-cell-name">
                        {ad.product?.image_url && (
                          <img
                            src={ad.product.image_url}
                            alt=""
                            style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover', marginRight: 8 }}
                          />
                        )}
                        <div>
                          <div style={{ fontSize: 13 }}>{ad.product?.name || ad.product_id.slice(0, 8)}</div>
                          {ad.product?.brand && <div style={{ fontSize: 11, color: '#999' }}>{ad.product.brand}</div>}
                        </div>
                      </td>

                      {/* Style */}
                      <td style={{ textTransform: 'capitalize', fontSize: 13 }}>
                        {ad.style.replace(/_/g, ' ')}
                      </td>

                      {/* Status */}
                      <td><StatusBadge status={ad.status} /></td>

                      {/* Impressions */}
                      <td style={{ fontSize: 13 }}>{(ad.impressions || 0).toLocaleString()}</td>

                      {/* Clicks */}
                      <td style={{ fontSize: 13 }}>{(ad.clicks || 0).toLocaleString()}</td>

                      {/* Created */}
                      <td className="admin-cell-muted" title={formatDate(ad.created_at)}>
                        {timeAgo(ad.created_at)}
                      </td>

                      {/* Actions */}
                      <td onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {(ad.status === 'done' || ad.status === 'paused') && (
                            <button
                              className="admin-btn admin-btn-primary"
                              style={{ fontSize: 11, padding: '3px 8px' }}
                              onClick={() => handleSetLive(ad.id)}
                              title="Set live in feed"
                            >
                              Go Live
                            </button>
                          )}
                          {ad.status === 'live' && (
                            <button
                              className="admin-btn admin-btn-secondary"
                              style={{ fontSize: 11, padding: '3px 8px' }}
                              onClick={() => handlePause(ad.id)}
                              title="Pause ad"
                            >
                              Pause
                            </button>
                          )}
                          {(ad.status === 'done' || ad.status === 'failed' || ad.status === 'paused') && (
                            <button
                              className="admin-btn admin-btn-secondary"
                              style={{ fontSize: 11, padding: '3px 8px' }}
                              onClick={() => handleRegenerate(ad.id)}
                              title="Regenerate video"
                            >
                              Regen
                            </button>
                          )}
                          <button
                            className="admin-btn admin-btn-secondary"
                            style={{ fontSize: 11, padding: '3px 8px', color: '#ef4444' }}
                            onClick={() => handleDelete(ad.id)}
                            title="Delete ad"
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={9} style={{ padding: 0 }}>
                          <div style={{ padding: '16px 20px', background: '#fafafa', borderBottom: '1px solid #eee' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                              {/* Left: Details */}
                              <div>
                                <h4 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600 }}>Ad Details</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 12px', fontSize: 12 }}>
                                  <span style={{ color: '#888' }}>Ad ID</span>
                                  <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{ad.id}</span>
                                  <span style={{ color: '#888' }}>Style</span>
                                  <span style={{ textTransform: 'capitalize' }}>{ad.style.replace(/_/g, ' ')}</span>
                                  <span style={{ color: '#888' }}>Veo Model</span>
                                  <span>{ad.veo_model || '—'}</span>
                                  <span style={{ color: '#888' }}>Duration</span>
                                  <span>{ad.duration_seconds}s</span>
                                  <span style={{ color: '#888' }}>Aspect Ratio</span>
                                  <span>{ad.aspect_ratio}</span>
                                  <span style={{ color: '#888' }}>Resolution</span>
                                  <span>{ad.resolution}</span>
                                  <span style={{ color: '#888' }}>Cost</span>
                                  <span>{ad.cost_usd ? `$${ad.cost_usd.toFixed(2)}` : '—'}</span>
                                  <span style={{ color: '#888' }}>Created</span>
                                  <span>{formatDate(ad.created_at)}</span>
                                  <span style={{ color: '#888' }}>Completed</span>
                                  <span>{formatDate(ad.completed_at)}</span>
                                  <span style={{ color: '#888' }}>Impressions</span>
                                  <span>{(ad.impressions || 0).toLocaleString()}</span>
                                  <span style={{ color: '#888' }}>Clicks</span>
                                  <span>{(ad.clicks || 0).toLocaleString()}</span>
                                  {ad.error && (
                                    <>
                                      <span style={{ color: '#ef4444' }}>Error</span>
                                      <span style={{ color: '#ef4444', fontSize: 11 }}>{ad.error}</span>
                                    </>
                                  )}
                                </div>

                                {/* Affiliate URL */}
                                <div style={{ marginTop: 16 }}>
                                  <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>Affiliate URL</h4>
                                  {editingUrlId === ad.id ? (
                                    <div style={{ display: 'flex', gap: 8 }}>
                                      <input
                                        type="url"
                                        value={editingUrlValue}
                                        onChange={e => setEditingUrlValue(e.target.value)}
                                        placeholder="https://..."
                                        style={{
                                          flex: 1, padding: '6px 10px', borderRadius: 6,
                                          border: '1px solid #ddd', fontSize: 12,
                                        }}
                                      />
                                      <button
                                        className="admin-btn admin-btn-primary"
                                        style={{ fontSize: 11, padding: '4px 12px' }}
                                        onClick={() => handleSaveUrl(ad.id)}
                                      >
                                        Save
                                      </button>
                                      <button
                                        className="admin-btn admin-btn-secondary"
                                        style={{ fontSize: 11, padding: '4px 12px' }}
                                        onClick={() => setEditingUrlId(null)}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <span style={{ fontSize: 12, color: ad.affiliate_url ? '#333' : '#999' }}>
                                        {ad.affiliate_url || 'No affiliate URL set'}
                                      </span>
                                      <button
                                        className="admin-btn admin-btn-secondary"
                                        style={{ fontSize: 11, padding: '2px 8px' }}
                                        onClick={() => { setEditingUrlId(ad.id); setEditingUrlValue(ad.affiliate_url || ad.product?.url || ''); }}
                                      >
                                        Edit
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Right: Prompt */}
                              <div>
                                <h4 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600 }}>Prompt</h4>
                                {ad.prompt ? (
                                  <div style={{
                                    background: '#fff', border: '1px solid #e5e5e5', borderRadius: 6,
                                    padding: 10, fontSize: 12, lineHeight: 1.5, maxHeight: 200,
                                    overflow: 'auto', whiteSpace: 'pre-wrap',
                                  }}>
                                    {ad.prompt}
                                  </div>
                                ) : (
                                  <span style={{ color: '#999', fontSize: 12 }}>No prompt recorded</span>
                                )}

                                {ad.description && (
                                  <>
                                    <h4 style={{ margin: '16px 0 8px', fontSize: 13, fontWeight: 600 }}>Ad Copy</h4>
                                    <div style={{
                                      background: '#fff', border: '1px solid #e5e5e5', borderRadius: 6,
                                      padding: 10, fontSize: 12, lineHeight: 1.5,
                                    }}>
                                      {ad.description}
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Video preview */}
                            {ad.video_url && (
                              <div style={{ marginTop: 16 }}>
                                <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>Video</h4>
                                <video
                                  src={ad.video_url}
                                  controls playsInline preload="metadata"
                                  style={{ maxWidth: 300, maxHeight: 400, borderRadius: 8, background: '#000' }}
                                />
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Video Preview Modal */}
      {previewAd && previewAd.video_url && (
        <div className="admin-modal-overlay" onClick={() => setPreviewAd(null)}>
          <div
            className="admin-modal"
            style={{ width: 'auto', maxWidth: '90vw', background: '#000', padding: 0, overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ position: 'relative' }}>
              <button
                className="admin-modal-close"
                style={{ position: 'absolute', top: 8, right: 8, zIndex: 1, color: '#fff' }}
                onClick={() => setPreviewAd(null)}
              >
                ×
              </button>
              <video
                src={previewAd.video_url}
                controls autoPlay playsInline
                style={{ maxWidth: '90vw', maxHeight: '80vh', display: 'block' }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Create Ads Modal */}
      {showCreate && (
        <div className="admin-modal-overlay" onClick={() => !creating && setShowCreate(false)}>
          <div
            className="admin-modal"
            style={{ width: 680, maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '20px 24px 0' }}>
              <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>Generate Product Ads</h2>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: '#888' }}>
                Select products and generate AI video ads using Veo + Claude
              </p>

              {/* Style & Count */}
              <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Video Style</label>
                  <select
                    value={selectedStyle}
                    onChange={e => setSelectedStyle(e.target.value)}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: 6,
                      border: '1px solid #ddd', fontSize: 13, background: '#fff',
                    }}
                  >
                    {AD_STYLES.map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
                <div style={{ width: 140 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Videos per product
                  </label>
                  <select
                    value={adCount}
                    onChange={e => setAdCount(Number(e.target.value))}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: 6,
                      border: '1px solid #ddd', fontSize: 13, background: '#fff',
                    }}
                  >
                    {[1, 2, 3].map(n => (
                      <option key={n} value={n}>{n} video{n > 1 ? 's' : ''}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Product search */}
              <div style={{ marginBottom: 12 }}>
                <input
                  type="text"
                  placeholder="Search products…"
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: 6,
                    border: '1px solid #ddd', fontSize: 13,
                  }}
                />
              </div>

              {selectedProducts.size > 0 && (
                <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                  {selectedProducts.size} product{selectedProducts.size > 1 ? 's' : ''} selected
                  → {selectedProducts.size * adCount} video{selectedProducts.size * adCount > 1 ? 's' : ''} will be generated
                </div>
              )}
            </div>

            {/* Product list */}
            <div style={{ flex: 1, overflow: 'auto', padding: '0 24px' }}>
              {filteredProducts.length === 0 ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: '#999', fontSize: 13 }}>
                  {products.length === 0 ? 'No products found. Scrape some products first.' : 'No products match your search.'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {filteredProducts.map(p => {
                    const isSelected = selectedProducts.has(p.id);
                    return (
                      <div
                        key={p.id}
                        onClick={() => toggleProductSelection(p.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
                          borderRadius: 8, cursor: 'pointer',
                          background: isSelected ? '#f0f7ff' : 'transparent',
                          border: `1px solid ${isSelected ? '#3b82f6' : 'transparent'}`,
                          transition: 'all 0.15s',
                        }}
                      >
                        {/* Checkbox */}
                        <div style={{
                          width: 20, height: 20, borderRadius: 4,
                          border: `2px solid ${isSelected ? '#3b82f6' : '#ccc'}`,
                          background: isSelected ? '#3b82f6' : '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0, transition: 'all 0.15s',
                        }}>
                          {isSelected && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </div>

                        {/* Product image */}
                        {p.image_url ? (
                          <img
                            src={p.image_url}
                            alt=""
                            style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
                          />
                        ) : (
                          <div style={{
                            width: 40, height: 40, borderRadius: 6, background: '#f0f0f0',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 10, color: '#999', flexShrink: 0,
                          }}>
                            No img
                          </div>
                        )}

                        {/* Product info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.name || 'Unnamed product'}
                          </div>
                          <div style={{ fontSize: 11, color: '#888' }}>
                            {p.brand || 'Unknown brand'} {p.price ? `· ${p.price}` : ''}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{
              padding: '16px 24px', borderTop: '1px solid #eee',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <button
                className="admin-btn admin-btn-secondary"
                onClick={() => !creating && setShowCreate(false)}
                disabled={creating}
              >
                Cancel
              </button>
              <button
                className="admin-btn admin-btn-primary"
                onClick={handleCreateAds}
                disabled={creating || selectedProducts.size === 0}
              >
                {creating
                  ? 'Creating…'
                  : `Generate ${selectedProducts.size * adCount} Ad${selectedProducts.size * adCount !== 1 ? 's' : ''}`
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
