import { useState, useEffect, useCallback, Fragment } from 'react';
import { useSortableTable, SortableTh } from '~/components/SortableTable';
import {
  getGeneratedVideos,
  retryGeneratedVideo,
  deleteGeneratedVideo,
  approveLook,
  denyLook,
  type GeneratedVideo,
} from '~/services/video-generation';

// ─── Status badge ────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: '#f59e0b',
    generating: '#3b82f6',
    uploading: '#8b5cf6',
    done: '#22c55e',
    failed: '#ef4444',
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

function formatCost(cost: number | null): string {
  if (cost === null || cost === undefined) return '—';
  return `$${cost.toFixed(2)}`;
}

// ─── Filter tabs ─────────────────────────────────────────────────────

type FilterTab = 'all' | 'pending' | 'generating' | 'done' | 'failed';

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'done', label: 'Completed' },
  { key: 'generating', label: 'In Progress' },
  { key: 'pending', label: 'Pending' },
  { key: 'failed', label: 'Failed' },
];

// ─── Main Page ───────────────────────────────────────────────────────

export default function AdminVideoGeneration() {
  const [videos, setVideos] = useState<GeneratedVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [previewVideo, setPreviewVideo] = useState<GeneratedVideo | null>(null);

  const loadVideos = useCallback(async () => {
    setLoading(true);
    const data = await getGeneratedVideos();
    setVideos(data);
    setLoading(false);
  }, []);

  useEffect(() => { loadVideos(); }, [loadVideos]);

  // Auto-refresh every 15s if there are active jobs
  useEffect(() => {
    const hasActive = videos.some(v => v.status === 'pending' || v.status === 'generating' || v.status === 'uploading');
    if (!hasActive) return;
    const interval = setInterval(loadVideos, 15_000);
    return () => clearInterval(interval);
  }, [videos, loadVideos]);

  const filtered = activeTab === 'all'
    ? videos
    : activeTab === 'generating'
      ? videos.filter(v => v.status === 'generating' || v.status === 'uploading')
      : videos.filter(v => v.status === activeTab);

  const { sortedData, sort, handleSort } = useSortableTable(filtered);

  const handleRetry = async (id: string) => {
    await retryGeneratedVideo(id);
    loadVideos();
  };

  const handleDelete = async (id: string) => {
    await deleteGeneratedVideo(id);
    loadVideos();
  };

  const handleApprove = async (lookId: string) => {
    await approveLook(lookId);
    loadVideos();
  };

  const handleDeny = async (lookId: string) => {
    await denyLook(lookId);
    loadVideos();
  };

  // Stats
  const totalCost = videos.reduce((sum, v) => sum + (v.cost_usd || 0), 0);
  const stats = [
    { label: 'Total Jobs', value: String(videos.length) },
    { label: 'Completed', value: String(videos.filter(v => v.status === 'done').length) },
    { label: 'In Progress', value: String(videos.filter(v => ['pending', 'generating', 'uploading'].includes(v.status)).length) },
    { label: 'Failed', value: String(videos.filter(v => v.status === 'failed').length) },
    { label: 'Total Cost', value: `$${totalCost.toFixed(2)}` },
  ];

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1>Video Generation</h1>
          <p className="admin-page-subtitle">Track AI-generated look videos</p>
        </div>
        <button className="admin-btn admin-btn-secondary" onClick={loadVideos} disabled={loading}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          Refresh
        </button>
      </div>

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
        {FILTER_TABS.map(tab => (
          <button
            key={tab.key}
            className={`admin-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            <span className="admin-tab-badge">
              {tab.key === 'all' ? videos.length
                : tab.key === 'generating'
                  ? videos.filter(v => ['pending', 'generating', 'uploading'].includes(v.status)).length
                  : videos.filter(v => v.status === tab.key).length}
            </span>
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="admin-empty">Loading video generation jobs…</div>
      ) : filtered.length === 0 ? (
        <div className="admin-empty">No video generation jobs {activeTab !== 'all' ? `with status "${activeTab}"` : 'yet'}.</div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>Preview</th>
                <SortableTh label="Product" sortKey="product" currentSort={sort} onSort={handleSort} />
                <SortableTh label="AI Model" sortKey="ai_model" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Style" sortKey="style" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Status" sortKey="status" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Cost" sortKey="cost_usd" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Created" sortKey="created_at" currentSort={sort} onSort={handleSort} />
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedData.map(v => {
                const isExpanded = expandedId === v.id;
                return (
                  <Fragment key={v.id}>
                    <tr
                      className="admin-clickable-row"
                      onClick={() => setExpandedId(prev => prev === v.id ? null : v.id)}
                    >
                      {/* Video thumbnail / preview */}
                      <td>
                        {v.video_url ? (
                          <div
                            style={{
                              width: 48, height: 64, borderRadius: 6, overflow: 'hidden',
                              background: '#111', cursor: 'pointer', position: 'relative',
                            }}
                            onClick={(e) => { e.stopPropagation(); setPreviewVideo(v); }}
                          >
                            <video
                              src={v.video_url}
                              muted
                              playsInline
                              preload="metadata"
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
                            {v.status === 'failed' ? '✕' : '…'}
                          </div>
                        )}
                      </td>

                      {/* Product */}
                      <td className="admin-cell-name">
                        {v.product?.image_url && (
                          <img
                            src={v.product.image_url}
                            alt=""
                            style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover', marginRight: 8 }}
                          />
                        )}
                        <div>
                          <div style={{ fontSize: 13 }}>{v.product?.name || v.product_id.slice(0, 8)}</div>
                          {v.product?.brand && <div style={{ fontSize: 11, color: '#999' }}>{v.product.brand}</div>}
                        </div>
                      </td>

                      {/* AI Model */}
                      <td>
                        {v.ai_model ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {v.ai_model.primary_image && (
                              <img
                                src={v.ai_model.primary_image}
                                alt=""
                                style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }}
                              />
                            )}
                            <span style={{ fontSize: 13 }}>{v.ai_model.name}</span>
                          </div>
                        ) : (
                          <span style={{ color: '#999', fontSize: 12 }}>—</span>
                        )}
                      </td>

                      {/* Style */}
                      <td style={{ textTransform: 'capitalize', fontSize: 13 }}>
                        {v.style.replace(/_/g, ' ')}
                      </td>

                      {/* Status */}
                      <td><StatusBadge status={v.status} /></td>

                      {/* Cost */}
                      <td style={{ fontSize: 13 }}>{formatCost(v.cost_usd)}</td>

                      {/* Created */}
                      <td className="admin-cell-muted" title={formatDate(v.created_at)}>
                        {timeAgo(v.created_at)}
                      </td>

                      {/* Actions */}
                      <td onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {v.status === 'failed' && (
                            <button
                              className="admin-btn admin-btn-secondary"
                              style={{ fontSize: 11, padding: '3px 8px' }}
                              onClick={() => handleRetry(v.id)}
                              title="Retry"
                            >
                              Retry
                            </button>
                          )}
                          {v.status === 'done' && v.look_id && (
                            <>
                              <button
                                className="admin-btn admin-btn-primary"
                                style={{ fontSize: 11, padding: '3px 8px' }}
                                onClick={() => handleApprove(v.look_id!)}
                                title="Approve look"
                              >
                                Approve
                              </button>
                              <button
                                className="admin-btn admin-btn-secondary"
                                style={{ fontSize: 11, padding: '3px 8px' }}
                                onClick={() => handleDeny(v.look_id!)}
                                title="Deny look"
                              >
                                Deny
                              </button>
                            </>
                          )}
                          <button
                            className="admin-btn admin-btn-secondary"
                            style={{ fontSize: 11, padding: '3px 8px', color: '#ef4444' }}
                            onClick={() => handleDelete(v.id)}
                            title="Delete job"
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} style={{ padding: 0 }}>
                          <div style={{ padding: '16px 20px', background: '#fafafa', borderBottom: '1px solid #eee' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                              {/* Left: Details */}
                              <div>
                                <h4 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600 }}>Job Details</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 12px', fontSize: 12 }}>
                                  <span style={{ color: '#888' }}>Job ID</span>
                                  <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{v.id}</span>
                                  <span style={{ color: '#888' }}>Veo Model</span>
                                  <span>{v.veo_model || '—'}</span>
                                  <span style={{ color: '#888' }}>Duration</span>
                                  <span>{v.duration_seconds}s</span>
                                  <span style={{ color: '#888' }}>Aspect Ratio</span>
                                  <span>{v.aspect_ratio}</span>
                                  <span style={{ color: '#888' }}>Resolution</span>
                                  <span>{v.resolution}</span>
                                  <span style={{ color: '#888' }}>Created</span>
                                  <span>{formatDate(v.created_at)}</span>
                                  <span style={{ color: '#888' }}>Completed</span>
                                  <span>{formatDate(v.completed_at)}</span>
                                  {v.look_id && (
                                    <>
                                      <span style={{ color: '#888' }}>Look ID</span>
                                      <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{v.look_id}</span>
                                    </>
                                  )}
                                  {v.error && (
                                    <>
                                      <span style={{ color: '#ef4444' }}>Error</span>
                                      <span style={{ color: '#ef4444', fontSize: 11 }}>{v.error}</span>
                                    </>
                                  )}
                                </div>
                              </div>

                              {/* Right: Prompt */}
                              <div>
                                <h4 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600 }}>Prompt</h4>
                                {v.prompt ? (
                                  <div style={{
                                    background: '#fff', border: '1px solid #e5e5e5', borderRadius: 6,
                                    padding: 10, fontSize: 12, lineHeight: 1.5, maxHeight: 200,
                                    overflow: 'auto', whiteSpace: 'pre-wrap',
                                  }}>
                                    {v.prompt}
                                  </div>
                                ) : (
                                  <span style={{ color: '#999', fontSize: 12 }}>No prompt recorded</span>
                                )}
                              </div>
                            </div>

                            {/* Video player (if done) */}
                            {v.video_url && (
                              <div style={{ marginTop: 16 }}>
                                <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>Video</h4>
                                <video
                                  src={v.video_url}
                                  controls
                                  playsInline
                                  preload="metadata"
                                  style={{
                                    maxWidth: 300, maxHeight: 400, borderRadius: 8,
                                    background: '#000',
                                  }}
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
      {previewVideo && previewVideo.video_url && (
        <div
          className="admin-modal-overlay"
          onClick={() => setPreviewVideo(null)}
        >
          <div
            className="admin-modal"
            style={{ width: 'auto', maxWidth: '90vw', background: '#000', padding: 0, overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ position: 'relative' }}>
              <button
                className="admin-modal-close"
                style={{ position: 'absolute', top: 8, right: 8, zIndex: 1, color: '#fff' }}
                onClick={() => setPreviewVideo(null)}
              >
                ×
              </button>
              <video
                src={previewVideo.video_url}
                controls
                autoPlay
                playsInline
                style={{ maxWidth: '80vw', maxHeight: '80vh', display: 'block' }}
              />
              <div style={{ padding: '12px 16px', color: '#fff' }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {previewVideo.product?.name || 'Untitled'}
                </div>
                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
                  {previewVideo.style.replace(/_/g, ' ')} • {previewVideo.ai_model?.name || 'Default model'} • {formatCost(previewVideo.cost_usd)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
