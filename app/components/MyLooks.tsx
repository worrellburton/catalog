import { useState, useEffect, useCallback } from 'react';
import LookForm from './LookForm';
import type { ManagedLook, LookStatus } from '~/services/manage-looks';
import { getMyLooks, deleteLook, archiveLook } from '~/services/manage-looks';

interface MyLooksProps {
  onClose: () => void;
}

const STATUS_LABELS: Record<LookStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  in_review: 'In Review',
  live: 'Live',
  denied: 'Denied',
  archived: 'Archived',
};

const STATUS_COLORS: Record<LookStatus, string> = {
  draft: '#888',
  submitted: '#f0ad4e',
  in_review: '#5bc0de',
  live: '#5cb85c',
  denied: '#d9534f',
  archived: '#777',
};

export default function MyLooks({ onClose }: MyLooksProps) {
  const [looks, setLooks] = useState<ManagedLook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<LookStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingLook, setEditingLook] = useState<ManagedLook | null>(null);

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchLooks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: { status?: LookStatus; page: number; limit: number } = { page, limit: 12 };
      if (statusFilter !== 'all') params.status = statusFilter;
      const res = await getMyLooks(params);
      setLooks(res.data);
      setTotalPages(res.pagination.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load looks');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page]);

  useEffect(() => {
    fetchLooks();
  }, [fetchLooks]);

  const handleCreateNew = useCallback(() => {
    setEditingLook(null);
    setShowForm(true);
  }, []);

  const handleEdit = useCallback((look: ManagedLook) => {
    setEditingLook(look);
    setShowForm(true);
  }, []);

  const handleFormSaved = useCallback(() => {
    setShowForm(false);
    setEditingLook(null);
    fetchLooks();
  }, [fetchLooks]);

  const handleFormCancel = useCallback(() => {
    setShowForm(false);
    setEditingLook(null);
  }, []);

  const handleDelete = useCallback(async (lookId: string) => {
    try {
      await deleteLook(lookId);
      setDeleteConfirm(null);
      setLooks(prev => prev.filter(l => l.id !== lookId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }, []);

  const handleArchive = useCallback(async (lookId: string) => {
    try {
      const res = await archiveLook(lookId);
      setLooks(prev => prev.map(l => l.id === lookId ? res.data : l));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Archive failed');
    }
  }, []);

  const getMediaPreview = (look: ManagedLook): string | null => {
    if (look.thumbnail_url) return look.thumbnail_url;
    if (look.look_photos?.length > 0) return look.look_photos[0].thumbnail_url || look.look_photos[0].url;
    if (look.look_videos?.length > 0) return look.look_videos[0].poster_url;
    return null;
  };

  if (showForm) {
    return (
      <div className="my-looks-overlay">
        <div className="my-looks-form-container">
          <LookForm
            look={editingLook}
            onSaved={handleFormSaved}
            onCancel={handleFormCancel}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="my-looks-overlay">
      <div className="my-looks-container">
        {/* Header */}
        <div className="my-looks-header">
          <div className="my-looks-header-left">
            <button className="my-looks-back" onClick={onClose} aria-label="Back">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
            <h1 className="my-looks-title">My Looks</h1>
          </div>
          <button className="my-looks-create-btn" onClick={handleCreateNew}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Look
          </button>
        </div>

        {/* Status filters */}
        <div className="my-looks-filters">
          {(['all', 'draft', 'submitted', 'live', 'archived'] as const).map(s => (
            <button
              key={s}
              className={`my-looks-filter-chip ${statusFilter === s ? 'active' : ''}`}
              onClick={() => { setStatusFilter(s); setPage(1); }}
            >
              {s === 'all' ? 'All' : STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && <div className="my-looks-error">{error}</div>}

        {/* Content */}
        {loading ? (
          <div className="my-looks-loading">
            <div className="my-looks-spinner" />
            <p>Loading your looks...</p>
          </div>
        ) : looks.length === 0 ? (
          <div className="my-looks-empty">
            <div className="my-looks-empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>
            <h3>No looks yet</h3>
            <p>Create your first look to share with the community</p>
            <button className="my-looks-create-btn" onClick={handleCreateNew}>
              Create Look
            </button>
          </div>
        ) : (
          <>
            <div className="my-looks-grid">
              {looks.map(look => {
                const preview = getMediaPreview(look);
                const mediaCount = (look.look_photos?.length || 0) + (look.look_videos?.length || 0);
                const productCount = look.look_products?.length || 0;

                return (
                  <div key={look.id} className="my-looks-card">
                    {/* Preview */}
                    <div className="my-looks-card-media" onClick={() => handleEdit(look)}>
                      {preview ? (
                        <img src={preview} alt={look.title} />
                      ) : (
                        <div className="my-looks-card-placeholder" style={{ backgroundColor: look.color || '#333' }}>
                          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <polyline points="21 15 16 10 5 21" />
                          </svg>
                        </div>
                      )}
                      <div className="my-looks-card-status" style={{ backgroundColor: STATUS_COLORS[look.status] }}>
                        {STATUS_LABELS[look.status]}
                      </div>
                    </div>

                    {/* Info */}
                    <div className="my-looks-card-info" onClick={() => handleEdit(look)}>
                      <h3 className="my-looks-card-title">{look.title}</h3>
                      <div className="my-looks-card-meta">
                        <span>{mediaCount} media</span>
                        <span>·</span>
                        <span>{productCount} products</span>
                      </div>
                      <div className="my-looks-card-date">
                        {new Date(look.created_at).toLocaleDateString()}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="my-looks-card-actions">
                      <button className="my-looks-card-action" onClick={() => handleEdit(look)} title="Edit">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                      </button>
                      {look.status !== 'archived' && (
                        <button className="my-looks-card-action" onClick={() => handleArchive(look.id)} title="Archive">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" /></svg>
                        </button>
                      )}
                      {look.status === 'archived' && (
                        <button className="my-looks-card-action" onClick={() => handleArchive(look.id)} title="Unarchive">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
                        </button>
                      )}
                      <button
                        className="my-looks-card-action danger"
                        onClick={() => setDeleteConfirm(look.id)}
                        title="Delete"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                      </button>
                    </div>

                    {/* Delete confirmation */}
                    {deleteConfirm === look.id && (
                      <div className="my-looks-delete-confirm">
                        <p>Delete this look?</p>
                        <div className="my-looks-delete-actions">
                          <button className="my-looks-btn-danger" onClick={() => handleDelete(look.id)}>Delete</button>
                          <button className="my-looks-btn-cancel" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="my-looks-pagination">
                <button
                  className="my-looks-page-btn"
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                >
                  Previous
                </button>
                <span className="my-looks-page-info">
                  Page {page} of {totalPages}
                </span>
                <button
                  className="my-looks-page-btn"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
