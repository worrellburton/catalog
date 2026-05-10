import { useState, useEffect, useCallback, useMemo } from 'react';
import LookForm from './LookForm';
import LookCard from './LookCard';
import { useAuth } from '~/hooks/useAuth';
import type { ManagedLook, LookStatus } from '~/services/manage-looks';
import { getMyLooks, deleteLook, archiveLook } from '~/services/manage-looks';
import type { Look, Product } from '~/data/looks';

interface MyLooksProps {
  onClose: () => void;
}

const STATUS_LABELS: Record<LookStatus, string> = {
  draft:     'Draft',
  submitted: 'Submitted',
  in_review: 'In Review',
  live:      'Live',
  denied:    'Denied',
  archived:  'Archived',
};

const STATUS_COLORS: Record<LookStatus, string> = {
  draft:     '#888',
  submitted: '#f0ad4e',
  in_review: '#5bc0de',
  live:      '#5cb85c',
  denied:    '#d9534f',
  archived:  '#777',
};

// Stable hash for the synthetic numeric id we hand to LookCard. LookCard
// keys off look.id and uses it for the trail-video handoff, so we need
// something deterministic per-managed-look UUID and disjoint from seed
// look ids (which are positive). Negative numbers buy us that without
// any DB lookup.
function hashId(uuid: string): number {
  let h = 0;
  for (let i = 0; i < uuid.length; i++) h = ((h << 5) - h + uuid.charCodeAt(i)) | 0;
  return -1 * (Math.abs(h) % 1_000_000) - 1;
}

// Pick the best preview asset for the LookCard's <video poster>. Photos
// win over poster frames because the catalog flow currently writes
// look_photos with thumbnails first, video posters only when a video is
// present. Falls back to the static thumbnail_url field.
function previewFor(look: ManagedLook): string | undefined {
  if (look.look_photos?.length > 0) {
    return look.look_photos[0].thumbnail_url || look.look_photos[0].url || undefined;
  }
  if (look.look_videos?.length > 0) {
    return look.look_videos[0].poster_url || undefined;
  }
  return undefined;
}

// Map ManagedLook (the my-looks REST shape) to Look (the LookCard shape)
// so the same tile component renders here as on CreatorPage.
function toLookShape(m: ManagedLook, currentCreatorHandle: string): Look {
  const products: Product[] = (m.look_products || []).map(lp => ({
    brand: lp.products.brand || '',
    name:  lp.products.name  || '',
    price: lp.products.price || '',
    url:   lp.products.url   || '',
    image: lp.products.image_url || undefined,
  }));
  const video = m.look_videos?.[0]?.url || '';
  return {
    id: hashId(m.id),
    uuid: m.id,
    title: m.title,
    video,
    gender: (m.gender || 'unisex') as Look['gender'],
    creator: currentCreatorHandle,
    description: m.description || '',
    color: m.color || '#222',
    products,
    thumbnail_url: previewFor(m),
  };
}

export default function MyLooks({ onClose }: MyLooksProps) {
  const { user } = useAuth();
  const [looks, setLooks] = useState<ManagedLook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<LookStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Form state (create or edit).
  const [showForm, setShowForm] = useState(false);
  const [editingLook, setEditingLook] = useState<ManagedLook | null>(null);

  // Delete confirmation.
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // "Creator Mode" toggle. When ON the tiles overlay edit / archive /
  // delete actions on top of the standard LookCard so the curator can
  // manage their catalog without leaving the grid. OFF renders the
  // identical layout consumers see on the CreatorPage.
  const [creatorMode, setCreatorMode] = useState(false);

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

  // ── Hero metadata ─────────────────────────────────────────────────
  const displayName = user?.displayName || user?.email?.split('@')[0] || 'My Catalog';
  const avatarUrl = user?.avatarUrl;
  const initial = (displayName || 'M').trim().charAt(0).toUpperCase() || 'M';
  const myCreatorHandle = user?.id ? `user:${user.id}` : '';

  // Counts for the hero stats line.
  const counts = useMemo(() => {
    const all = looks.length;
    const live = looks.filter(l => l.status === 'live').length;
    const draft = looks.filter(l => l.status === 'draft').length;
    const archived = looks.filter(l => l.status === 'archived').length;
    return { all, live, draft, archived };
  }, [looks]);

  // Map managed looks to the Look shape LookCard expects.
  const tileLooks = useMemo(
    () => looks.map(m => ({ managed: m, look: toLookShape(m, myCreatorHandle) })),
    [looks, myCreatorHandle],
  );

  // ── Form mode renders the editor full-screen (unchanged behavior) ──
  if (showForm) {
    return (
      <div className="my-cat-page my-cat-page--form">
        <div className="my-cat-form-container">
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
    <div className="my-cat-page">
      {/* Top-left back. Mirrors CreatorPage.creator-back. */}
      <button className="my-cat-back" onClick={onClose} aria-label="Back">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Back
      </button>

      {/* Top-right "+" button — opens the create form. */}
      <button
        className="my-cat-create-fab"
        onClick={handleCreateNew}
        aria-label="New look"
        title="New look"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>

      {/* Hero — same layout as CreatorPage.creator-hero. */}
      <div className="my-cat-hero">
        {avatarUrl ? (
          <img className="my-cat-hero-avatar" src={avatarUrl} alt={displayName} />
        ) : (
          <div className="my-cat-hero-avatar my-cat-hero-avatar--initial">{initial}</div>
        )}
        <span className="my-cat-hero-curated">Curated by</span>
        <h1 className="my-cat-hero-name">{displayName}</h1>

        {/* Creator Mode toggle. Sits where CreatorPage shows the Follow
            button — only the curator themselves sees this surface. */}
        <button
          className={`my-cat-mode-toggle${creatorMode ? ' is-on' : ''}`}
          onClick={() => setCreatorMode(m => !m)}
          aria-pressed={creatorMode}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          {creatorMode ? 'Creator Mode On' : 'Creator Mode'}
        </button>

        <p className="my-cat-hero-stats">
          {counts.all === 0
            ? 'Your catalog is empty — tap + to publish your first look.'
            : `${counts.all} look${counts.all === 1 ? '' : 's'} · ${counts.live} live · ${counts.draft} draft${counts.draft === 1 ? '' : 's'}`}
        </p>
      </div>

      {/* Status filter pills — replace the old chip row, sit where
          CreatorPage's nav tabs do. */}
      <div className="my-cat-nav">
        {(['all', 'draft', 'submitted', 'live', 'archived'] as const).map(s => (
          <button
            key={s}
            className={`my-cat-nav-tab${statusFilter === s ? ' active' : ''}`}
            onClick={() => { setStatusFilter(s); setPage(1); }}
          >
            {s === 'all' ? 'All' : STATUS_LABELS[s]}
            {s === 'all' && counts.all > 0 && <span className="my-cat-nav-count">{counts.all}</span>}
            {s === 'live' && counts.live > 0 && <span className="my-cat-nav-count">{counts.live}</span>}
            {s === 'draft' && counts.draft > 0 && <span className="my-cat-nav-count">{counts.draft}</span>}
            {s === 'archived' && counts.archived > 0 && <span className="my-cat-nav-count">{counts.archived}</span>}
          </button>
        ))}
      </div>

      {error && <div className="my-cat-error">{error}</div>}

      {/* Grid / loading / empty states — same pattern as CreatorPage. */}
      {loading ? (
        <div className="my-cat-skeleton-grid">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="my-cat-skeleton-tile" />)}
        </div>
      ) : tileLooks.length === 0 ? (
        <div className="my-cat-empty">
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          <h2>No looks yet</h2>
          <p>Tap the + button to create your first look.</p>
          <button className="my-cat-empty-btn" onClick={handleCreateNew}>Create a Look</button>
        </div>
      ) : (
        <>
          <div className="my-cat-grid">
            {tileLooks.map(({ managed, look }) => (
              <div key={managed.id} className={`my-cat-tile${creatorMode ? ' my-cat-tile--editing' : ''}`}>
                <LookCard
                  look={look}
                  className="look-card"
                  onOpenLook={() => handleEdit(managed)}
                  onOpenCreator={() => {}}
                  hideCreator
                />

                {/* Status pill — always visible so the curator can spot
                    drafts at a glance (matches the prior MyLooks UX). */}
                <span
                  className="my-cat-tile-status"
                  style={{ backgroundColor: STATUS_COLORS[managed.status] }}
                >
                  {STATUS_LABELS[managed.status]}
                </span>

                {/* Edit/Archive/Delete actions — shown only in Creator
                    Mode. stopPropagation on the action wrapper so taps
                    don't bubble to the LookCard click handler. */}
                {creatorMode && (
                  <div
                    className="my-cat-tile-actions"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <button
                      className="my-cat-tile-action"
                      onClick={() => handleEdit(managed)}
                      title="Edit"
                      aria-label="Edit"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                    </button>
                    <button
                      className="my-cat-tile-action"
                      onClick={() => handleArchive(managed.id)}
                      title={managed.status === 'archived' ? 'Unarchive' : 'Archive'}
                      aria-label={managed.status === 'archived' ? 'Unarchive' : 'Archive'}
                    >
                      {managed.status === 'archived' ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" /></svg>
                      )}
                    </button>
                    <button
                      className="my-cat-tile-action my-cat-tile-action--danger"
                      onClick={() => setDeleteConfirm(managed.id)}
                      title="Delete"
                      aria-label="Delete"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                    </button>
                  </div>
                )}

                {/* Inline delete confirmation. Sits over the tile so the
                    confirm-flow stays scoped to the card the user
                    targeted. */}
                {deleteConfirm === managed.id && (
                  <div className="my-cat-delete-confirm" onClick={(e) => e.stopPropagation()}>
                    <p>Delete this look?</p>
                    <div className="my-cat-delete-actions">
                      <button className="my-cat-btn-danger" onClick={() => handleDelete(managed.id)}>Delete</button>
                      <button className="my-cat-btn-cancel" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="my-cat-pagination">
              <button
                className="my-cat-page-btn"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
              >Previous</button>
              <span className="my-cat-page-info">Page {page} of {totalPages}</span>
              <button
                className="my-cat-page-btn"
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
              >Next</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
