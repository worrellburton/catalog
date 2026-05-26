import { useState, useEffect, useCallback, useMemo } from 'react';
import LookForm from './LookForm';
import { useAuth } from '~/hooks/useAuth';
import type { ManagedLook, LookStatus } from '~/services/manage-looks';
import { getMyLooks, deleteLook, archiveLook } from '~/services/manage-looks';
import { withTransform } from '~/utils/supabase-image';
import { supabase } from '~/utils/supabase';
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

  // Delete confirmation.
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Analytics modal — opened from the bar-chart FAB in the top-right.
  // Calls user_creator_analytics_summary RPC and filters to the
  // signed-in user's row so the creator sees their own numbers.
  const [showAnalytics, setShowAnalytics] = useState(false);

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

  // Pre-compute previews so the render loop stays cheap.
  const tiles = useMemo(
    () => looks.map(m => ({ managed: m, preview: previewFor(m) })),
    [looks],
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

      {/* Top-right pair: analytics + create. Both circular icon FABs
          so they read as a coherent pill of creator-only actions. */}
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
        <button
          className="my-cat-create-fab"
          onClick={handleCreateNew}
          aria-label="Upload look"
          title="Upload look"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
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
                className={`my-cat-tile${creatorMode ? ' my-cat-tile--editing' : ''}`}
                onClick={() => handleEdit(managed)}
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
