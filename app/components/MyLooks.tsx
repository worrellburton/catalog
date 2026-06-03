import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from '@remix-run/react';
import CreateLookV2 from './CreateLookV2';
import AddProductV2 from './AddProductV2';
import { useAuth } from '~/hooks/useAuth';
import type { ManagedLook, LookStatus } from '~/services/manage-looks';
import { getMyLooks, deleteLook, archiveLook, submitLook } from '~/services/manage-looks';
import { withTransform } from '~/utils/supabase-image';
import { supabase } from '~/utils/supabase';
import { lookSlug } from '~/utils/slug';
import AutoplayVideo from '~/components/AutoplayVideo';

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

// Pick the best preview asset for the tile. looks_creative is where
// every generated look lands today (video_url + thumbnail_url), so it
// wins. look_photos / look_videos only get rows from the legacy
// manual-upload path and stay as a fallback. Returning the video and
// poster separately lets the tile autoplay the clip on top of a real
// still — same pattern the main feed uses on LookCard.
function previewFor(look: ManagedLook): { video: string | null; poster: string | null } | null {
  const creatives = look.looks_creative ?? [];
  const primary = creatives.find(c => c.is_primary) ?? creatives[0];
  if (primary) {
    const video = primary.mobile_video_url || primary.video_url || null;
    const poster = primary.thumbnail_url || null;
    if (video || poster) return { video, poster };
  }
  if (look.look_photos?.length > 0) {
    const src = look.look_photos[0].thumbnail_url || look.look_photos[0].url;
    if (src) return { video: null, poster: src };
  }
  if (look.look_videos?.length > 0) {
    const v = look.look_videos[0];
    if (v.url || v.poster_url) return { video: v.url ?? null, poster: v.poster_url ?? null };
  }
  return null;
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

  // Add Product flow — same hero pattern as CreateLookV2.
  const [showAddProduct, setShowAddProduct] = useState(false);

  // Delete confirmation.
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Analytics modal — opened from the bar-chart FAB in the top-right.
  const [showAnalytics, setShowAnalytics] = useState(false);

  // Catalog theme is now PINNED to dark across every viewer. The
  // light variant kept getting toggled on by accident and the user
  // asked for dark to be the only mode on catalog feeds. The state
  // ref + toggle are kept as no-op compatibility shims so the JSX
  // sites that still read them keep compiling — but no light path
  // is reachable. The on-screen toggle button has been removed too
  // (see the FAB row below).
  const catalogTheme: 'dark' = 'dark';
  const toggleCatalogTheme = useCallback(() => { /* dark only */ }, []);

  // "+" FAB menu in the top-right. Opens to three actions: Upload
  // New Look (existing form), Add AI looks (generate flow), Add
  // product (admin/data ingest). Outside-click + Escape close.
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const navigate = useNavigate();

  // Per-look actions surface two ways:
  //   • Desktop (hover-capable): an action bar fades in on tile hover.
  //   • Touch: tapping a tile opens a bottom tool tray. trayLook holds
  //     the look whose tray is open (null = closed).
  const [trayLook, setTrayLook] = useState<ManagedLook | null>(null);
  // Ephemeral confirmation toast ("Link copied", etc.).
  const [toast, setToast] = useState<string | null>(null);

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

  // Toggle a look's visibility: live → archived (hidden) and back.
  // The status dot on the tile reads the same flag — green when
  // live, red when hidden — so the dot flips in lockstep with this.
  const handleToggleLive = useCallback(async (look: ManagedLook) => {
    try {
      const res = look.status === 'live'
        ? await archiveLook(look.id)
        : await submitLook(look.id);
      setLooks(prev => prev.map(l => l.id === look.id ? res.data : l));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update visibility');
    }
  }, []);

  // Ephemeral toast for action feedback (link copied, etc.).
  const showToastMsg = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(curr => (curr === msg ? null : curr)), 2400);
  }, []);

  // Share a look's public URL. Native share sheet when available
  // (mobile / supported desktop), otherwise copy to clipboard.
  const handleShare = useCallback(async (look: ManagedLook) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const slug = lookSlug({
      id: look.id,
      title: look.title,
      creator: user?.id ? `user:${user.id}` : '',
      creatorDisplayName: user?.displayName || null,
    });
    const url = `${origin}/l/${slug}`;
    try {
      const nav = navigator as Navigator & { share?: (d: { title?: string; url?: string }) => Promise<void> };
      if (nav.share) {
        await nav.share({ title: look.title || 'Check out this look', url });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        showToastMsg('Link copied');
      }
    } catch {
      // User dismissed the share sheet, or clipboard denied — no-op.
    }
  }, [user?.id, user?.displayName, showToastMsg]);

  // Tile click routing: touch devices open the bottom tool tray;
  // hover-capable devices open the editor directly (the hover action
  // bar covers share/delete there).
  const handleTileClick = useCallback((look: ManagedLook) => {
    const touch = typeof window !== 'undefined'
      && window.matchMedia('(hover: none)').matches;
    if (touch) setTrayLook(look);
    else handleEdit(look);
  }, [handleEdit]);

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

  // Pre-compute previews so the render loop stays cheap.
  const tiles = useMemo(
    () => looks.map(m => ({ managed: m, preview: previewFor(m) })),
    [looks],
  );

  // ── Add product flow — full-screen, same shell as the look form ──
  if (showAddProduct) {
    return (
      <div className="my-cat-page my-cat-page--form">
        <div className="my-cat-form-container">
          <AddProductV2 onCancel={() => setShowAddProduct(false)} />
        </div>
      </div>
    );
  }

  // ── Form mode renders the editor full-screen (unchanged behavior) ──
  if (showForm) {
    return (
      <div className="my-cat-page my-cat-page--form">
        <div className="my-cat-form-container">
          <CreateLookV2
            look={editingLook}
            onPublished={handleFormSaved}
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

      {/* Top-right pair: analytics + create. The catalog theme toggle
          that used to live first in this row has been removed — every
          catalog feed is now dark-only (see catalogTheme constant
          above). */}
      <div className="my-cat-fab-row">
        <button
          className="my-cat-create-fab my-cat-analytics-fab"
          onClick={() => setShowAnalytics(true)}
          aria-label="Analytics"
          title="Analytics"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="3" y1="20" x2="21" y2="20"/>
            <rect x="6"  y="11" width="3" height="9"/>
            <rect x="11" y="6"  width="3" height="14"/>
            <rect x="16" y="14" width="3" height="6"/>
          </svg>
        </button>
        <div style={{ position: 'relative' }}>
          <button
            className="my-cat-create-fab my-cat-create-fab--dropdown"
            onClick={() => setCreateMenuOpen(v => !v)}
            aria-label="Add"
            title="Add"
            aria-expanded={createMenuOpen}
            aria-haspopup="menu"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            <svg
              width="12" height="12" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true"
              style={{ marginLeft: 2, transition: 'transform 180ms cubic-bezier(.32,.72,0,1)', transform: createMenuOpen ? 'rotate(180deg)' : 'rotate(0)' }}
            >
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          {createMenuOpen && (
            <>
              {/* Tap-out scrim so any click outside the menu dismisses it */}
              <div
                onClick={() => setCreateMenuOpen(false)}
                style={{ position: 'fixed', inset: 0, zIndex: 38, background: 'transparent' }}
                aria-hidden="true"
              />
              <div
                role="menu"
                className="my-cat-create-menu"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  right: 0,
                  minWidth: 220,
                  background: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: 12,
                  boxShadow: '0 18px 40px rgba(15,23,42,0.25)',
                  padding: 6,
                  zIndex: 40,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                <MenuItem
                  icon={
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                  }
                  label="Upload New Look"
                  onClick={() => { setCreateMenuOpen(false); handleCreateNew(); }}
                />
                <MenuItem
                  icon={
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2l1.7 4.3L18 8l-4.3 1.7L12 14l-1.7-4.3L6 8l4.3-1.7L12 2z"/>
                      <path d="M19 14l1 2.5 2.5 1L20 18.5 19 21l-1-2.5L15.5 17.5 18 16.5z"/>
                    </svg>
                  }
                  label="Add AI looks"
                  onClick={() => { setCreateMenuOpen(false); navigate('/generate'); }}
                />
                <MenuItem
                  icon={
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/>
                      <line x1="3" y1="6" x2="21" y2="6"/>
                      <path d="M16 10a4 4 0 0 1-8 0"/>
                    </svg>
                  }
                  label="Add product"
                  onClick={() => { setCreateMenuOpen(false); setShowAddProduct(true); }}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {showAnalytics && <CreatorAnalyticsModal onClose={() => setShowAnalytics(false)} />}

      {/* Hero — same layout as CreatorPage.creator-hero. */}
      <div className="my-cat-hero">
        {avatarUrl ? (
          <img className="my-cat-hero-avatar" src={avatarUrl} alt={displayName} />
        ) : (
          <div className="my-cat-hero-avatar my-cat-hero-avatar--initial">{initial}</div>
        )}
        <span className="my-cat-hero-curated">Curated by</span>
        <h1 className="my-cat-hero-name">{displayName}</h1>

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
      ) : tiles.length === 0 ? (
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
            {tiles.map(({ managed, preview }) => (
              <div
                key={managed.id}
                className="my-cat-tile"
                onClick={() => handleTileClick(managed)}
                role="button"
                tabIndex={0}
              >
                {/* Image-based preview. We deliberately avoid the
                    consumer LookCard here because its TrailVideoHost
                    handoff is wired to the public feed pool — managed
                    looks aren't in that pool, so the video slot would
                    render empty. A simple <img> covers every state
                    (photo, poster frame, color placeholder). */}
                <div className="my-cat-tile-media">
                  {preview ? (
                    preview.video ? (
                      // AutoplayVideo pauses when scrolled off-screen
                      // via the shared useInViewport pool, so tiles
                      // below the fold stop spending CPU on muted loops.
                      <AutoplayVideo
                        className="my-cat-tile-img"
                        src={preview.video}
                        poster={withTransform(preview.poster, { width: 540, quality: 70 })}
                      />
                    ) : preview.poster ? (
                      <img
                        className="my-cat-tile-img"
                        src={withTransform(preview.poster, { width: 540, quality: 70 })}
                        alt={managed.title}
                        loading="lazy"
                        decoding="async"
                      />
                    ) : null
                  ) : (
                    <div
                      className="my-cat-tile-placeholder"
                      style={{ backgroundColor: managed.color || '#222' }}
                    >
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                      </svg>
                    </div>
                  )}
                  {/* Title intentionally hidden — the user asked for
                      a clean tile-only grid here. Visual scrim kept
                      so the status pill remains legible on bright
                      thumbnails. */}
                  <div className="my-cat-tile-scrim" />
                </div>

                {/* Status dot — green when live, red when hidden
                    (archived/denied), amber while in review. Less
                    visual noise than the old text pill but still
                    glanceable so the curator can spot drafts and
                    hidden looks instantly. The tray exposes a toggle
                    to flip live ↔ hidden. */}
                <span
                  className={`my-cat-tile-dot my-cat-tile-dot--${managed.status}`}
                  aria-label={STATUS_LABELS[managed.status]}
                  title={STATUS_LABELS[managed.status]}
                />

                {/* Desktop hover actions — edit / share / delete. Fades
                    in on tile hover (CSS); hidden on touch devices, which
                    use the bottom tool tray instead. stopPropagation so a
                    click on an icon doesn't also trigger the tile. */}
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
                    onClick={() => handleShare(managed)}
                    title="Share"
                    aria-label="Share"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>
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

      {/* Mobile tool tray — slides up when a tile is tapped on touch
          devices. Edit / Share / Archive / Delete, with the look's
          thumbnail + title as the header so it's clear which look is
          being acted on. */}
      {trayLook && (() => {
        const tp = previewFor(trayLook);
        return (
          <div className="my-cat-tray-backdrop" onClick={() => setTrayLook(null)}>
            <div className="my-cat-tray" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Look actions">
              <div className="my-cat-tray-grip" />
              <div className="my-cat-tray-head">
                <div className="my-cat-tray-thumb" style={{ backgroundColor: trayLook.color || '#222' }}>
                  {tp?.poster && <img src={withTransform(tp.poster, { width: 120, quality: 70 })} alt="" />}
                </div>
                <div className="my-cat-tray-head-text">
                  <span className="my-cat-tray-title">{trayLook.title || 'Untitled look'}</span>
                  <span className="my-cat-tray-status" style={{ color: STATUS_COLORS[trayLook.status] }}>
                    {STATUS_LABELS[trayLook.status]}
                  </span>
                </div>
              </div>
              <button className="my-cat-tray-action" onClick={() => { const l = trayLook; setTrayLook(null); handleEdit(l); }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                <span>Edit</span>
              </button>
              <button className="my-cat-tray-action" onClick={() => { const l = trayLook; setTrayLook(null); void handleShare(l); }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>
                <span>Share</span>
              </button>
              <button className="my-cat-tray-action" onClick={() => { setTrayLook(null); setShowAnalytics(true); }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="20" x2="21" y2="20"/><rect x="6"  y="11" width="3" height="9"/><rect x="11" y="6"  width="3" height="14"/><rect x="16" y="14" width="3" height="6"/></svg>
                <span>Analytics</span>
              </button>
              {/* Live ↔ Hide toggle. Currently live → "Hide" (red dot
                  on the tile after); anything else (draft, archived,
                  denied) → "Make live" (green dot after). Same dot
                  color the tile uses, so the user sees the action map
                  to the visual state. */}
              {(() => {
                const isLive = trayLook.status === 'live';
                return (
                  <button className="my-cat-tray-action" onClick={() => { const l = trayLook; setTrayLook(null); void handleToggleLive(l); }}>
                    <span className={`my-cat-tray-dot my-cat-tray-dot--${isLive ? 'archived' : 'live'}`} aria-hidden="true" />
                    <span>{isLive ? 'Hide' : 'Make live'}</span>
                  </button>
                );
              })()}
              <button className="my-cat-tray-action my-cat-tray-action--danger" onClick={() => { const id = trayLook.id; setTrayLook(null); setDeleteConfirm(id); }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                <span>Delete</span>
              </button>
              <button className="my-cat-tray-cancel" onClick={() => setTrayLook(null)}>Cancel</button>
            </div>
          </div>
        );
      })()}

      {/* Delete confirmation — centered modal, works on desktop + touch. */}
      {deleteConfirm && (
        <div className="my-cat-confirm-backdrop" onClick={() => setDeleteConfirm(null)}>
          <div className="my-cat-confirm" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-label="Delete look">
            <h3>Delete this look?</h3>
            <p>This permanently removes “{looks.find(l => l.id === deleteConfirm)?.title || 'this look'}” from your catalog. This can’t be undone.</p>
            <div className="my-cat-confirm-actions">
              <button className="my-cat-btn-cancel" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="my-cat-btn-danger" onClick={() => handleDelete(deleteConfirm)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="my-cat-toast" role="status">{toast}</div>}
    </div>
  );
}

interface CreatorStatsRow {
  user_id: string;
  full_name: string | null;
  looks_posted: number;
  total_impressions: number;
  total_clicks: number;
  total_clickouts: number;
}

/**
 * Modal that surfaces the creator's own analytics rollup. Same RPC
 * the admin Creators tab uses (user_creator_analytics_summary) —
 * we filter to the signed-in user's row so the creator sees just
 * their numbers without admin clutter.
 */
function CreatorAnalyticsModal({ onClose }: { onClose: () => void }) {
  const [row, setRow] = useState<CreatorStatsRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supabase) { setLoading(false); return; }
      const { data: { user: signedIn } } = await supabase.auth.getUser();
      if (!signedIn?.id) { if (!cancelled) setLoading(false); return; }
      const { data } = await supabase.rpc('user_creator_analytics_summary');
      if (cancelled) return;
      const mine = (data as CreatorStatsRow[] | null)?.find(r => r.user_id === signedIn.id) ?? null;
      setRow(mine);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const clickThroughPct = row && row.total_impressions > 0
    ? ((row.total_clicks / row.total_impressions) * 100).toFixed(1)
    : null;
  const clickoutPct = row && row.total_clicks > 0
    ? ((row.total_clickouts / row.total_clicks) * 100).toFixed(1)
    : null;

  return (
    <div className="my-cat-analytics-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="my-cat-analytics-card" onClick={e => e.stopPropagation()}>
        <header className="my-cat-analytics-head">
          <h2>Your analytics</h2>
          <button type="button" className="my-cat-analytics-close" onClick={onClose} aria-label="Close">×</button>
        </header>
        {loading ? (
          <div className="my-cat-analytics-empty">Loading…</div>
        ) : !row ? (
          <div className="my-cat-analytics-empty">No analytics yet — your looks need impressions before stats land here.</div>
        ) : (
          <div className="my-cat-analytics-grid">
            <Stat label="Looks live"     value={row.looks_posted.toLocaleString()} />
            <Stat label="Impressions"    value={row.total_impressions.toLocaleString()} />
            <Stat label="Clicks"         value={row.total_clicks.toLocaleString()} sub={clickThroughPct ? `${clickThroughPct}% CTR` : undefined} />
            <Stat label="Clickouts"      value={row.total_clickouts.toLocaleString()} sub={clickoutPct ? `${clickoutPct}% of clicks` : undefined} />
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="my-cat-stat">
      <span className="my-cat-stat-label">{label}</span>
      <span className="my-cat-stat-value">{value}</span>
      {sub && <span className="my-cat-stat-sub">{sub}</span>}
    </div>
  );
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '10px 12px',
        background: 'transparent',
        border: 'none',
        borderRadius: 8,
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: 13,
        fontWeight: 500,
        color: '#0f172a',
        textAlign: 'left',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#f1f5f9'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
    >
      <span style={{ width: 28, height: 28, borderRadius: 6, background: '#f4f4f5', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#0f172a', flexShrink: 0 }}>
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}
