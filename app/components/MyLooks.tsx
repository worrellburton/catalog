import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from '@remix-run/react';
import CreateLookV2 from './CreateLookV2';
import AddProductV2 from './AddProductV2';
import { useAuth } from '~/hooks/useAuth';
import { downloadLookVideo, type DownloadVariant } from '~/utils/downloadLookVideo';
import type { ManagedLook, LookStatus } from '~/services/manage-looks';
import { getMyLooks, deleteLook, reorderLooks, setLookLive } from '~/services/manage-looks';
import { getMyCatalogProducts, reorderMyCatalogProducts, type CatalogProduct } from '~/services/catalog-products';
import { ensureGenerationsInCatalog } from '~/services/promote-generation';
import { listUserGenerations, isGenerationInFlight, type UserGeneration } from '~/services/user-generations';
import ParticleBackground from './ParticleBackground';
import { getMyCatalogAppearance, setMyCatalogAppearance, type CatalogAppearance, DEFAULT_CATALOG_APPEARANCE } from '~/services/catalog-theme';
import { withTransform } from '~/utils/supabase-image';
import { supabase } from '~/utils/supabase';
import { lookSlug } from '~/utils/slug';
import AutoplayVideo from '~/components/AutoplayVideo';

interface MyLooksProps {
  onClose: () => void;
}

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
  const [statusFilter, setStatusFilter] = useState<'live' | 'inactive' | 'products'>('live');
  const [page, setPage] = useState(1);
  // Auto-hiding top UI: the hero + tabs stay stuck to the top, slide away as
  // the user scrolls down into the grid, and slide back when they scroll up,
  // stop, or return to the very top.
  const pageRef = useRef<HTMLDivElement>(null);
  const [topHidden, setTopHidden] = useState(false);
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    let last = el.scrollTop;
    let stopTimer: number | null = null;
    const onScroll = () => {
      const y = el.scrollTop;
      if (y <= 8) setTopHidden(false);
      else if (y > last + 4) setTopHidden(true);
      else if (y < last - 4) setTopHidden(false);
      last = y;
      if (stopTimer != null) window.clearTimeout(stopTimer);
      stopTimer = window.setTimeout(() => setTopHidden(false), 220);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (stopTimer != null) window.clearTimeout(stopTimer);
    };
  }, []);
  const [totalPages, setTotalPages] = useState(1);

  // "Products" tab — every product across the creator's looks, drag-orderable.
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  // Counts for the hero stat line + tab badges — fetched independently of the
  // active filter so removing the "All" tab didn't break the totals.
  const [counts, setCounts] = useState({ all: 0, live: 0, archived: 0 });

  // Looks currently rendering — surfaced in a dedicated "Rendering" section
  // that only appears while at least one generation is in flight.
  const [rendering, setRendering] = useState<UserGeneration[]>([]);
  useEffect(() => {
    if (!user?.id) { setRendering([]); return; }
    let cancelled = false;
    const load = () => listUserGenerations(user.id!)
      .then(gens => { if (!cancelled) setRendering(gens.filter(isGenerationInFlight)); })
      .catch(() => {});
    load();
    // Poll while mounted so a freshly-kicked render appears and clears
    // without leaving the page.
    const t = window.setInterval(load, 5000);
    return () => { cancelled = true; window.clearInterval(t); };
  }, [user?.id]);

  // Catalog appearance (particles + background hue) — the creator customises
  // their catalog from the settings gear; applied live to this page.
  const [appearance, setAppearance] = useState<CatalogAppearance>(DEFAULT_CATALOG_APPEARANCE);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => { getMyCatalogAppearance().then(setAppearance).catch(() => {}); }, []);
  const updateAppearance = useCallback((patch: Partial<CatalogAppearance>) => {
    setAppearance(prev => ({ ...prev, ...patch }));
    setMyCatalogAppearance(patch).catch(() => {});
  }, []);

  // Form state (create or edit).
  const [showForm, setShowForm] = useState(false);
  const [editingLook, setEditingLook] = useState<ManagedLook | null>(null);

  // Add Product flow — same hero pattern as CreateLookV2.
  const [showAddProduct, setShowAddProduct] = useState(false);

  // Delete confirmation.
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Analytics modal. analyticsLook = null means the FAB opened it
  // (catalog-wide view). analyticsLook = a ManagedLook means the
  // tile tray opened it (per-look view).
  const [analyticsLook, setAnalyticsLook] = useState<ManagedLook | null>(null);
  const [showAnalyticsOpen, setShowAnalyticsOpen] = useState(false);

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
  // The "+" menu is two-level: root (Add look / Add product) → 'look' shows
  // the two ways to add a look (own media vs AI).
  const [createMenuView, setCreateMenuView] = useState<'root' | 'look'>('root');
  const navigate = useNavigate();

  // Per-look actions surface two ways:
  //   • Desktop (hover-capable): an action bar fades in on tile hover.
  //   • Touch: tapping a tile opens a bottom tool tray. trayLook holds
  //     the look whose tray is open (null = closed).
  const [trayLook, setTrayLook] = useState<ManagedLook | null>(null);
  // Whether the Download action's 3-variant sub-tree is expanded in the tray.
  const [dlOpen, setDlOpen] = useState(false);
  useEffect(() => { if (!trayLook) setDlOpen(false); }, [trayLook]);
  // Ephemeral confirmation toast ("Link copied", etc.).
  const [toast, setToast] = useState<string | null>(null);

  const refreshCounts = useCallback(async () => {
    try {
      const res = await getMyLooks({ page: 1, limit: 200 });
      const ls = res.data;
      // Published === live; everything else === inactive (the new rule).
      const live = ls.filter(l => l.status === 'live').length;
      setCounts({
        all: ls.length,
        live,
        archived: ls.length - live,
      });
    } catch { /* keep prior counts */ }
  }, []);

  const fetchLooks = useCallback(async () => {
    if (statusFilter === 'products') { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const params: { status?: LookStatus | 'inactive'; page: number; limit: number } = { page, limit: 12 };
      if (statusFilter === 'live' || statusFilter === 'inactive') params.status = statusFilter;
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
    refreshCounts();
  }, [fetchLooks, refreshCounts]);

  // Backfill: make sure EVERY completed generation has a looks row, so looks
  // that finished after the creator left /generate still show up here as
  // Inactive. Runs once per mount; if it creates anything, refresh the list +
  // counts so the new Inactive looks appear without a manual reload.
  const reconciledRef = useRef(false);
  useEffect(() => {
    if (reconciledRef.current) return;
    reconciledRef.current = true;
    let cancelled = false;
    ensureGenerationsInCatalog()
      .then(created => {
        if (!cancelled && created > 0) { fetchLooks(); refreshCounts(); }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [fetchLooks, refreshCounts]);

  // Load the aggregated product list when the Products tab is active.
  const fetchCatalogProducts = useCallback(async () => {
    setProductsLoading(true);
    try {
      setCatalogProducts(await getMyCatalogProducts());
    } finally {
      setProductsLoading(false);
    }
  }, []);
  useEffect(() => {
    if (statusFilter === 'products') fetchCatalogProducts();
  }, [statusFilter, fetchCatalogProducts]);

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
  // Ephemeral toast for action feedback (link copied, etc.).
  const showToastMsg = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(curr => (curr === msg ? null : curr)), 2400);
  }, []);

  // The status dot on the tile reads the same flag — green when
  // live, red when hidden — so the dot flips in lockstep with this.
  const handleToggleLive = useCallback(async (look: ManagedLook) => {
    const goingLive = look.status !== 'live';
    // Optimistic flip so the dot + tab counts update instantly.
    setLooks(prev => prev.map(l => l.id === look.id
      ? { ...l, status: goingLive ? 'live' : 'archived' }
      : l));
    try {
      const updated = await setLookLive(look.id, goingLive);
      setLooks(prev => prev.map(l => l.id === look.id ? updated : l));
      refreshCounts();
      showToastMsg(goingLive ? 'Look is live' : 'Look set to inactive');
      // If the current tab no longer matches the look's new status, drop it
      // from view (it moved to the other tab).
      if ((statusFilter === 'live') !== goingLive) {
        setLooks(prev => prev.filter(l => l.id !== look.id));
      }
    } catch (err) {
      // Roll back the optimistic flip on failure.
      setLooks(prev => prev.map(l => l.id === look.id ? look : l));
      setError(err instanceof Error ? err.message : 'Could not update visibility');
    }
  }, [refreshCounts, showToastMsg, statusFilter]);

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

  // Download the look's video to the device, watermarked with the Catalog
  // wordmark (top-left) and named {username}-catalog-{date}. The watermark
  // re-encode runs for ~the clip's length, so we toast progress.
  const handleDownload = useCallback(async (look: ManagedLook, variant: DownloadVariant = 'logo') => {
    const videoUrl = previewFor(look)?.video;
    if (!videoUrl) { showToastMsg('No video to download'); return; }
    showToastMsg(variant === 'logo' ? 'Preparing download…' : 'Composing your video…');
    try {
      const products = (look.look_products || [])
        .slice()
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map(lp => ({
          name: lp.products?.name || 'Product',
          brand: lp.products?.brand ?? null,
          price: lp.products?.price ?? null,
          image_url: lp.products?.image_url ?? null,
        }));
      await downloadLookVideo(videoUrl, user?.displayName || user?.email || 'creator', {
        variant,
        products,
        creatorHandle: user?.displayName || user?.email?.split('@')[0] || null,
      });
      showToastMsg('Saved to your device');
    } catch {
      showToastMsg('Download failed');
    }
  }, [user?.displayName, user?.email, showToastMsg]);

  // Tile click routing: touch devices open the bottom tool tray;
  // hover-capable devices open the editor directly (the hover action
  // bar covers share/delete there).
  const handleTileClick = useCallback((look: ManagedLook) => {
    // Same action popup on every platform — desktop used to jump straight to
    // Edit, but it should surface the same tray (View / Edit / Share /
    // Analytics / Download) that mobile shows.
    setTrayLook(look);
  }, []);

  // ── Drag-to-reorder ───────────────────────────────────────────────
  // Pointer-based (works for touch + mouse) reorder, initiated from the
  // grip handle so tapping the tile body still opens it. Only offered on
  // the "All" view — filtered views show a non-contiguous subset, so
  // writing sequential sort_order there would scramble hidden looks.
  const canReorder = statusFilter === 'live' || statusFilter === 'inactive';
  const [dragId, setDragId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const looksRef = useRef<ManagedLook[]>([]);
  useEffect(() => { looksRef.current = looks; }, [looks]);

  const handleGripDown = useCallback((e: React.PointerEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    dragIdRef.current = id;
    setDragId(id);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const handleGripMove = useCallback((e: React.PointerEvent) => {
    if (!dragIdRef.current) return;
    e.preventDefault();
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const overId = el?.closest('[data-look-id]')?.getAttribute('data-look-id');
    if (!overId || overId === dragIdRef.current) return;
    setLooks(prev => {
      const from = prev.findIndex(l => l.id === dragIdRef.current);
      const to = prev.findIndex(l => l.id === overId);
      if (from === -1 || to === -1 || from === to) return prev;
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const handleGripUp = useCallback(async (e: React.PointerEvent) => {
    if (!dragIdRef.current) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    dragIdRef.current = null;
    setDragId(null);
    try {
      await reorderLooks(looksRef.current.map(l => l.id), (page - 1) * 12);
    } catch {
      showToastMsg('Could not save order');
    }
  }, [page, showToastMsg]);

  // ── Products-tab drag-reorder (vertical list, mirrors the look grip) ──
  const [dragProductId, setDragProductId] = useState<string | null>(null);
  const dragProductRef = useRef<string | null>(null);
  const productsRef = useRef<CatalogProduct[]>([]);
  useEffect(() => { productsRef.current = catalogProducts; }, [catalogProducts]);

  const handleProductGripDown = useCallback((e: React.PointerEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    dragProductRef.current = id;
    setDragProductId(id);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const handleProductGripMove = useCallback((e: React.PointerEvent) => {
    if (!dragProductRef.current) return;
    e.preventDefault();
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const overId = el?.closest('[data-product-id]')?.getAttribute('data-product-id');
    if (!overId || overId === dragProductRef.current) return;
    setCatalogProducts(prev => {
      const from = prev.findIndex(p => p.id === dragProductRef.current);
      const to = prev.findIndex(p => p.id === overId);
      if (from === -1 || to === -1 || from === to) return prev;
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const handleProductGripUp = useCallback(async (e: React.PointerEvent) => {
    if (!dragProductRef.current) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    dragProductRef.current = null;
    setDragProductId(null);
    try {
      await reorderMyCatalogProducts(productsRef.current.map(p => p.id));
    } catch {
      showToastMsg('Could not save order');
    }
  }, [showToastMsg]);

  // ── Hero metadata ─────────────────────────────────────────────────
  const displayName = user?.displayName || user?.email?.split('@')[0] || 'My Catalog';
  const avatarUrl = user?.avatarUrl;
  // Fall back to the initial if the avatar URL fails to load (broken/stale
  // storage object, OAuth URL hiccup) instead of rendering an empty ring.
  const [avatarFailed, setAvatarFailed] = useState(false);
  useEffect(() => { setAvatarFailed(false); }, [avatarUrl]);
  const initial = (displayName || 'M').trim().charAt(0).toUpperCase() || 'M';
  const myCreatorHandle = user?.id ? `user:${user.id}` : '';

  // Counts for the hero stats line.
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
    <div
      ref={pageRef}
      className="my-cat-page"
      style={appearance.hue != null ? { background: `hsl(${appearance.hue}, 28%, 6%)` } : undefined}
    >
      {/* Creator-chosen appearance: particle field behind content (z-index:-1
          so it floats over the page bg without covering anything) + the hue
          tint applied to the page background above. */}
      {appearance.particles && (
        <div className="my-cat-particles" aria-hidden="true"><ParticleBackground /></div>
      )}
      {/* Back sits top-LEFT (conventional), styled as the same pill.
          Analytics + Create stay together top-right in the fab row. */}
      <button
        className="my-cat-create-fab my-cat-back-fab"
        onClick={onClose}
        aria-label="Back"
        title="Back"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      {/* Top-right row: Appearance / Analytics / Create. */}
      <div className="my-cat-fab-row">
        <button
          className="my-cat-create-fab my-cat-settings-fab"
          onClick={() => setSettingsOpen(true)}
          aria-label="Catalog appearance"
          title="Catalog appearance"
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        <button
          className="my-cat-create-fab my-cat-analytics-fab"
          onClick={() => { setAnalyticsLook(null); setShowAnalyticsOpen(true); }}
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
            onClick={() => { setCreateMenuOpen(v => !v); setCreateMenuView('root'); }}
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
                onClick={() => { setCreateMenuOpen(false); setCreateMenuView('root'); }}
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
                {createMenuView === 'root' ? (
                  <>
                    <MenuItem
                      icon={
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="2" y="4" width="20" height="16" rx="2"/>
                          <polygon points="10 9 15 12 10 15 10 9"/>
                        </svg>
                      }
                      label="Add look"
                      onClick={() => setCreateMenuView('look')}
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
                  </>
                ) : (
                  <>
                    <MenuItem
                      icon={
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                          <polyline points="17 8 12 3 7 8"/>
                          <line x1="12" y1="3" x2="12" y2="15"/>
                        </svg>
                      }
                      label="With your own pictures & videos"
                      onClick={() => { setCreateMenuOpen(false); setCreateMenuView('root'); handleCreateNew(); }}
                    />
                    <MenuItem
                      icon={
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 2l1.7 4.3L18 8l-4.3 1.7L12 14l-1.7-4.3L6 8l4.3-1.7L12 2z"/>
                          <path d="M19 14l1 2.5 2.5 1L20 18.5 19 21l-1-2.5L15.5 17.5 18 16.5z"/>
                        </svg>
                      }
                      label="Create a look with AI"
                      onClick={() => { setCreateMenuOpen(false); setCreateMenuView('root'); navigate('/generate'); }}
                    />
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {showAnalyticsOpen && (
        <CreatorAnalyticsModal
          look={analyticsLook}
          onClose={() => setShowAnalyticsOpen(false)}
        />
      )}

      {/* Hero — the WHOLE block is a button that opens the profile
          edit screen (photos, name, gender, body, age all live there).
          The inner "My info" pill is still here for an explicit text
          affordance, but tapping anywhere on the hero — avatar, name,
          curated-by, stats — fires the same event. */}
      <div className={`my-cat-top${topHidden ? ' is-hidden' : ''}`}>
      <button
        type="button"
        className="my-cat-hero my-cat-hero--button"
        onClick={() => window.dispatchEvent(new CustomEvent('catalog:open-profile'))}
        aria-label="Edit your catalog identity"
      >
        {avatarUrl && !avatarFailed ? (
          <img
            className="my-cat-hero-avatar"
            src={avatarUrl}
            alt={displayName}
            referrerPolicy="no-referrer"
            onError={() => setAvatarFailed(true)}
          />
        ) : (
          <div className="my-cat-hero-avatar my-cat-hero-avatar--initial">{initial}</div>
        )}
        <span className="my-cat-hero-curated">Curated by</span>
        <h1 className="my-cat-hero-name">{displayName}</h1>

        {/* "My info" pill still lives in the slot where CreatorPage
            shows Follow — explicit affordance for the same tap. The
            inner click stops propagation so the outer hero button
            doesn't double-fire. */}
        <span
          className="my-cat-hero-info"
          aria-hidden="true"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
          </svg>
          My info
        </span>

        <p className="my-cat-hero-stats">
          {counts.all === 0
            ? 'Your catalog is empty — tap + to publish your first look.'
            : `${counts.all} look${counts.all === 1 ? '' : 's'} · ${counts.live} live · ${counts.archived} inactive`}
        </p>
      </button>

      {/* Status filter pills — replace the old chip row, sit where
          CreatorPage's nav tabs do. */}
      <div className="my-cat-nav">
        {(['live', 'inactive'] as const).map(s => (
          <button
            key={s}
            className={`my-cat-nav-tab${statusFilter === s ? ' active' : ''}`}
            onClick={() => { setStatusFilter(s); setPage(1); }}
          >
            {s === 'live' ? 'Live' : 'Inactive'}
            {s === 'live' && counts.live > 0 && <span className="my-cat-nav-count">{counts.live}</span>}
            {s === 'inactive' && counts.archived > 0 && <span className="my-cat-nav-count">{counts.archived}</span>}
          </button>
        ))}
        {/* Divider separates look-status tabs from the Products view. */}
        <span className="my-cat-nav-divider" aria-hidden="true" />
        <button
          className={`my-cat-nav-tab${statusFilter === 'products' ? ' active' : ''}`}
          onClick={() => { setStatusFilter('products'); setPage(1); }}
        >
          Products
          {catalogProducts.length > 0 && <span className="my-cat-nav-count">{catalogProducts.length}</span>}
        </button>
      </div>
      </div>

      {/* Rendering section — only present while looks are mid-render.
          Disappears entirely once nothing is in flight. */}
      {rendering.length > 0 && (
        <section className="my-cat-rendering">
          <div className="my-cat-rendering-head">
            <span className="my-cat-rendering-title">Rendering on my catalog</span>
            <span className="my-cat-rendering-count">{rendering.length}</span>
          </div>
          <div className="my-cat-rendering-row">
            {rendering.map(g => (
              <div key={g.id} className="my-cat-rendering-tile" title={`${g.display_name || g.style || 'New look'} — rendering`}>
                <div className="my-cat-rendering-shimmer" />
                <div className="my-cat-rendering-foot">
                  <span className="my-cat-rendering-name">{g.display_name || g.style || 'New look'}</span>
                  <span className="my-cat-rendering-bar"><span className="my-cat-rendering-bar-fill" /></span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {error && <div className="my-cat-error">{error}</div>}

      {/* Grid / loading / empty states — same pattern as CreatorPage. */}
      {statusFilter === 'products' ? (
        productsLoading ? (
          <div className="my-cat-skeleton-grid">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="my-cat-skeleton-tile" />)}
          </div>
        ) : catalogProducts.length === 0 ? (
          <div className="my-cat-empty">
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>
            </svg>
            <h2>No products yet</h2>
            <p>Products you add to your looks will show up here.</p>
          </div>
        ) : (
          <div className="creator-grid my-cat-products-grid">
            {catalogProducts.map(p => (
              <div
                key={p.id}
                data-product-id={p.id}
                className={`look-card creator-product-feed my-cat-product-feed${dragProductId === p.id ? ' is-dragging' : ''}`}
              >
                {p.image_url
                  ? <img className="cpf-media" src={p.image_url} alt={p.name} loading="lazy" decoding="async" />
                  : <div className="cpf-media cpf-media--blank" />}
                <div className="cpf-gradient" />
                <button
                  type="button"
                  className="my-cat-product-grip my-cat-product-grip--feed"
                  aria-label="Drag to reorder"
                  title="Drag to reorder"
                  onPointerDown={(e) => handleProductGripDown(e, p.id)}
                  onPointerMove={handleProductGripMove}
                  onPointerUp={handleProductGripUp}
                  onPointerCancel={handleProductGripUp}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
                </button>
                <div className="cpf-info">
                  {p.brand && <span className="cpf-brand">{p.brand}</span>}
                  <span className="cpf-name">{p.name}</span>
                  {p.price && <span className="cpf-price">{p.price}</span>}
                </div>
              </div>
            ))}
          </div>
        )
      ) : loading ? (
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
                data-look-id={managed.id}
                className={`my-cat-tile${dragId === managed.id ? ' is-dragging' : ''}`}
                onClick={() => handleTileClick(managed)}
                role="button"
                tabIndex={0}
              >
                {canReorder && (
                  <button
                    type="button"
                    className="my-cat-tile-grip"
                    aria-label="Drag to reorder"
                    title="Drag to reorder"
                    onPointerDown={(e) => handleGripDown(e, managed.id)}
                    onPointerMove={handleGripMove}
                    onPointerUp={handleGripUp}
                    onPointerCancel={handleGripUp}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" />
                      <circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" />
                      <circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" />
                    </svg>
                  </button>
                )}
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
                  className={`my-cat-tile-dot my-cat-tile-dot--${managed.status === 'live' ? 'live' : 'inactive'}`}
                  aria-label={managed.status === 'live' ? 'Live' : 'Inactive'}
                  title={managed.status === 'live' ? 'Live' : 'Inactive'}
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
                  {tp?.video ? (
                    <video
                      src={tp.video}
                      poster={tp.poster ? withTransform(tp.poster, { width: 120, quality: 70 }) : undefined}
                      muted
                      loop
                      autoPlay
                      playsInline
                      preload="metadata"
                    />
                  ) : tp?.poster ? (
                    <img src={withTransform(tp.poster, { width: 120, quality: 70 })} alt="" />
                  ) : null}
                </div>
                <div className="my-cat-tray-head-text">
                  {/* Title removed at the user's request — the look's
                      thumbnail (video preferred over poster) is the
                      identification, and the status label below it
                      tells the rest of the story. */}
                  <span className="my-cat-tray-status" style={{ color: trayLook.status === 'live' ? '#22c55e' : '#f59e0b' }}>
                    {trayLook.status === 'live' ? 'Live' : 'Inactive'}
                  </span>
                </div>
              </div>
              <button className="my-cat-tray-action" onClick={() => { const l = trayLook; setTrayLook(null); navigate(`/?look=${l.id}`); }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                <span>View</span>
              </button>
              <button className="my-cat-tray-action" onClick={() => { const l = trayLook; setTrayLook(null); handleEdit(l); }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                <span>Edit</span>
              </button>
              <button className="my-cat-tray-action" onClick={() => { const l = trayLook; setTrayLook(null); void handleShare(l); }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>
                <span>Share</span>
              </button>
              <button className="my-cat-tray-action" onClick={() => { const l = trayLook; setTrayLook(null); setAnalyticsLook(l); setShowAnalyticsOpen(true); }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="20" x2="21" y2="20"/><rect x="6"  y="11" width="3" height="9"/><rect x="11" y="6"  width="3" height="14"/><rect x="16" y="14" width="3" height="6"/></svg>
                <span>Analytics</span>
              </button>
              <button className="my-cat-tray-action" onClick={() => setDlOpen(o => !o)} aria-expanded={dlOpen}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                <span>Download</span>
                <svg className={`my-cat-tray-chevron${dlOpen ? ' is-open' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
              </button>
              {dlOpen && (
                <div className="my-cat-tray-subtree">
                  <button className="my-cat-tray-suboption" onClick={() => { const l = trayLook; setTrayLook(null); void handleDownload(l, 'logo'); }}>
                    <span className="my-cat-tray-subnum">1</span>
                    <span className="my-cat-tray-subtext">
                      <span className="my-cat-tray-subtitle">Catalog watermark</span>
                      <span className="my-cat-tray-subdesc">The logo, top-left</span>
                    </span>
                  </button>
                  <button className="my-cat-tray-suboption" onClick={() => { const l = trayLook; setTrayLook(null); void handleDownload(l, 'products'); }}>
                    <span className="my-cat-tray-subnum">2</span>
                    <span className="my-cat-tray-subtext">
                      <span className="my-cat-tray-subtitle">Product showcase</span>
                      <span className="my-cat-tray-subdesc">Ad-style — products on top</span>
                    </span>
                  </button>
                  <button className="my-cat-tray-suboption" onClick={() => { const l = trayLook; setTrayLook(null); void handleDownload(l, 'story'); }}>
                    <span className="my-cat-tray-subnum">3</span>
                    <span className="my-cat-tray-subtext">
                      <span className="my-cat-tray-subtitle">Story-ready</span>
                      <span className="my-cat-tray-subdesc">Made to post to your story</span>
                    </span>
                  </button>
                </div>
              )}
              {/* Live ↔ Inactive segmented control. Live on the left
                  (green), Inactive on the right (yellow). Whichever
                  pill represents the OTHER state is the action — tap
                  it to flip there. Mirrors the new tile dot palette
                  (green=live, yellow=archived/draft/denied). */}
              {(() => {
                const isLive = trayLook.status === 'live';
                return (
                  <div className="my-cat-tray-status-row" role="group" aria-label="Visibility">
                    <button
                      type="button"
                      className={`my-cat-tray-status-pill my-cat-tray-status-pill--live${isLive ? ' is-current' : ''}`}
                      onClick={() => { if (isLive) return; const l = trayLook; setTrayLook(null); void handleToggleLive(l); }}
                      aria-pressed={isLive}
                    >
                      <span className="my-cat-tray-dot my-cat-tray-dot--live" aria-hidden="true" />
                      <span>{isLive ? 'Live' : 'Go live'}</span>
                    </button>
                    <button
                      type="button"
                      className={`my-cat-tray-status-pill my-cat-tray-status-pill--inactive${!isLive ? ' is-current' : ''}`}
                      onClick={() => { if (!isLive) return; const l = trayLook; setTrayLook(null); void handleToggleLive(l); }}
                      aria-pressed={!isLive}
                    >
                      <span className="my-cat-tray-dot my-cat-tray-dot--inactive" aria-hidden="true" />
                      <span>{!isLive ? 'Inactive' : 'Go inactive'}</span>
                    </button>
                  </div>
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

      {settingsOpen && (
        <div className="my-cat-settings-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="my-cat-settings-panel" onClick={(e) => e.stopPropagation()}>
            <div className="my-cat-settings-head">
              <h3>Catalog appearance</h3>
              <button className="my-cat-settings-close" onClick={() => setSettingsOpen(false)} aria-label="Close">×</button>
            </div>

            {/* Particles on/off */}
            <button
              type="button"
              className="my-cat-settings-row"
              onClick={() => updateAppearance({ particles: !appearance.particles })}
            >
              <span className="my-cat-settings-label">Particles</span>
              <span className={`my-cat-toggle${appearance.particles ? ' is-on' : ''}`} aria-hidden="true">
                <span className="my-cat-toggle-knob" />
              </span>
            </button>

            {/* Background hue */}
            <div className="my-cat-settings-row my-cat-settings-row--col">
              <div className="my-cat-settings-hue-head">
                <span className="my-cat-settings-label">Background color</span>
                {appearance.hue != null && (
                  <button type="button" className="my-cat-settings-clear" onClick={() => updateAppearance({ hue: null })}>None</button>
                )}
              </div>
              <input
                type="range"
                min={0}
                max={360}
                value={appearance.hue ?? 210}
                onChange={(e) => updateAppearance({ hue: parseInt(e.target.value, 10) })}
                className="my-cat-hue-slider"
                aria-label="Background hue"
              />
              <div
                className="my-cat-hue-preview"
                style={{ background: appearance.hue != null ? `hsl(${appearance.hue}, 28%, 14%)` : '#0a0a0a' }}
                aria-hidden="true"
              />
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

// ── Time-range filter ────────────────────────────────────────────
// Pill row at the top of the analytics modal. Values resolve to a
// concrete (startISO, endISO|null) at query time so the same code
// path serves "today" and "all time" without branching.
type RangeId = 'all' | 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth';
const RANGE_LABELS: Record<RangeId, string> = {
  all:       'All time',
  today:     'Today',
  yesterday: 'Yesterday',
  thisWeek:  'This week',
  lastWeek:  'Last week',
  thisMonth: 'This month',
  lastMonth: 'Last month',
};
const RANGE_ORDER: RangeId[] = ['all','today','yesterday','thisWeek','lastWeek','thisMonth','lastMonth'];

function rangeBounds(r: RangeId): { startISO: string | null; endISO: string | null } {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = (() => {
    const d = new Date(startOfToday);
    const day = (d.getDay() + 6) % 7; // Monday=0
    d.setDate(d.getDate() - day);
    return d;
  })();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  if (r === 'all')       return { startISO: null, endISO: null };
  if (r === 'today')     return { startISO: startOfToday.toISOString(), endISO: null };
  if (r === 'yesterday') {
    const yesterday = new Date(startOfToday); yesterday.setDate(yesterday.getDate() - 1);
    return { startISO: yesterday.toISOString(), endISO: startOfToday.toISOString() };
  }
  if (r === 'thisWeek')  return { startISO: startOfWeek.toISOString(), endISO: null };
  if (r === 'lastWeek') {
    const lwStart = new Date(startOfWeek); lwStart.setDate(lwStart.getDate() - 7);
    return { startISO: lwStart.toISOString(), endISO: startOfWeek.toISOString() };
  }
  if (r === 'thisMonth') return { startISO: startOfMonth.toISOString(), endISO: null };
  // lastMonth
  const lmStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return { startISO: lmStart.toISOString(), endISO: startOfMonth.toISOString() };
}

// Shape returned by the loader — handles BOTH per-look and catalog-
// wide queries. Per-look just leaves the *List arrays empty.
interface AnalyticsData {
  impressions: number;
  clicks: number;
  clickouts: number;
  /** Daily impression counts (ascending) for the trend graph. */
  series: { day: string; count: number }[];
  // Catalog-wide detail. Empty in per-look mode.
  topLook: { id: string; title: string; impressions: number; clicks: number; ctr: number } | null;
  topProductsByImpressions: { name: string; brand: string | null; count: number }[];
  topProductsByClicks: { name: string; brand: string | null; count: number }[];
  topProductsByClickouts: { name: string; brand: string | null; count: number }[];
}

/**
 * Analytics modal. Catalog-wide when `look` is null; per-look when
 * a ManagedLook is passed in. The time-range pill row at the top
 * scopes every metric so the user can flick between today / week /
 * month without leaving the modal.
 */
function CreatorAnalyticsModal({ look, onClose }: { look: ManagedLook | null; onClose: () => void }) {
  const { user } = useAuth();
  const userId = user?.id || null;
  const [range, setRange] = useState<RangeId>('all');
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  // Escape closes the modal — mirrors the legacy behavior.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Re-fetch whenever the look scope or the time range changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supabase || !userId) { setLoading(false); return; }
      setLoading(true);
      const { startISO, endISO } = rangeBounds(range);

      // ── Per-look mode ─────────────────────────────────────────
      // Three simple counts against user_events. Clickouts are
      // attributed by joining look_products → user_events on the
      // product target_uuid.
      if (look) {
        const baseImpressions = supabase.from('user_events')
          .select('id', { count: 'exact', head: true })
          .eq('event_type', 'impression').eq('target_type', 'look').eq('target_uuid', look.id);
        const baseClicks = supabase.from('user_events')
          .select('id', { count: 'exact', head: true })
          .eq('event_type', 'click').eq('target_type', 'look').eq('target_uuid', look.id);

        const productIds = (look.look_products || [])
          .map(lp => lp.products?.id).filter((v): v is string => !!v);

        const [imp, clk, clko] = await Promise.all([
          (startISO ? baseImpressions.gte('created_at', startISO) : baseImpressions),
          (startISO ? baseClicks.gte('created_at', startISO) : baseClicks),
          productIds.length > 0
            ? (() => {
                let q = supabase!.from('user_events')
                  .select('id', { count: 'exact', head: true })
                  .eq('event_type', 'clickout').eq('target_type', 'product').in('target_uuid', productIds);
                if (startISO) q = q.gte('created_at', startISO);
                if (endISO) q = q.lt('created_at', endISO);
                return q;
              })()
            : Promise.resolve({ count: 0, data: null, error: null }),
        ]);
        if (cancelled) return;
        setData({
          impressions: imp.count || 0,
          clicks: clk.count || 0,
          clickouts: clko.count || 0,
          series: [], // per-look path uses count queries; no daily series here
          topLook: null,
          topProductsByImpressions: [],
          topProductsByClicks: [],
          topProductsByClickouts: [],
        });
        setLoading(false);
        return;
      }

      // ── Catalog-wide mode ──────────────────────────────────────
      // Pull raw events (capped at 10k for sanity) scoped to this
      // creator's content via target_owner_id, then aggregate in JS
      // so we can compute "top look" + "top products by metric"
      // without three more RPCs.
      let evQ = supabase.from('user_events')
        .select('event_type, target_type, target_uuid, target_id, context, created_at')
        .eq('target_owner_id', userId)
        .in('event_type', ['impression','click','clickout'])
        .order('created_at', { ascending: false })
        .limit(10_000);
      if (startISO) evQ = evQ.gte('created_at', startISO);
      if (endISO) evQ = evQ.lt('created_at', endISO);
      const { data: events } = await evQ;
      if (cancelled) return;

      // Map look_id → counts so we can find the top performer.
      const lookAgg = new Map<string, { impressions: number; clicks: number }>();
      const impByProduct = new Map<string, { brand: string | null; name: string; count: number }>();
      const clkByProduct = new Map<string, { brand: string | null; name: string; count: number }>();
      const clkoByProduct = new Map<string, { brand: string | null; name: string; count: number }>();
      let totalImp = 0, totalClk = 0, totalClko = 0;
      const dayImp = new Map<string, number>(); // YYYY-MM-DD → impressions

      const splitContext = (ctx: string | null): { brand: string | null; name: string } => {
        if (!ctx) return { brand: null, name: 'Product' };
        const parts = ctx.split(' · ');
        if (parts.length >= 2) return { brand: parts[0], name: parts.slice(1).join(' · ') };
        return { brand: null, name: ctx };
      };

      (events || []).forEach(e => {
        if (e.event_type === 'impression' && e.target_type === 'look' && e.target_uuid) {
          totalImp++;
          const slot = lookAgg.get(e.target_uuid) || { impressions: 0, clicks: 0 };
          slot.impressions++;
          lookAgg.set(e.target_uuid, slot);
          const day = ((e.created_at as string) || '').slice(0, 10);
          if (day) dayImp.set(day, (dayImp.get(day) || 0) + 1);
        }
        if (e.event_type === 'click' && e.target_type === 'look' && e.target_uuid) {
          totalClk++;
          const slot = lookAgg.get(e.target_uuid) || { impressions: 0, clicks: 0 };
          slot.clicks++;
          lookAgg.set(e.target_uuid, slot);
        }
        if (e.event_type === 'impression' && e.target_type === 'product' && e.target_uuid) {
          const key = e.target_uuid;
          const meta = splitContext(e.context as string | null);
          const slot = impByProduct.get(key) || { ...meta, count: 0 };
          slot.count++;
          impByProduct.set(key, slot);
        }
        if (e.event_type === 'click' && e.target_type === 'product' && e.target_uuid) {
          const key = e.target_uuid;
          const meta = splitContext(e.context as string | null);
          const slot = clkByProduct.get(key) || { ...meta, count: 0 };
          slot.count++;
          clkByProduct.set(key, slot);
        }
        if (e.event_type === 'clickout' && (e.target_type === 'product' || e.target_type === 'product_url')) {
          totalClko++;
          const key = (e.target_uuid as string | null) || (e.target_id as string | null) || `_${totalClko}`;
          const meta = splitContext(e.context as string | null);
          const slot = clkoByProduct.get(key) || { ...meta, count: 0 };
          slot.count++;
          clkoByProduct.set(key, slot);
        }
      });

      // Top look by impressions, then resolve its title from props.
      let topLook: AnalyticsData['topLook'] = null;
      if (lookAgg.size > 0) {
        const [topId, topRow] = [...lookAgg.entries()].sort((a, b) => b[1].impressions - a[1].impressions)[0];
        const title = (events || [])
          .find(e => e.target_uuid === topId && (e.context as string | null))?.context as string | null
          || 'Look';
        topLook = {
          id: topId,
          title,
          impressions: topRow.impressions,
          clicks: topRow.clicks,
          ctr: topRow.impressions > 0 ? (topRow.clicks / topRow.impressions) * 100 : 0,
        };
      }

      const topN = <T extends { count: number }>(m: Map<string, T>, n: number) =>
        [...m.values()].sort((a, b) => b.count - a.count).slice(0, n);

      const series = [...dayImp.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, count]) => ({ day, count }));

      setData({
        impressions: totalImp,
        clicks: totalClk,
        clickouts: totalClko,
        series,
        topLook,
        topProductsByImpressions: topN(impByProduct, 5),
        topProductsByClicks: topN(clkByProduct, 5),
        topProductsByClickouts: topN(clkoByProduct, 5),
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [look, userId, range]);

  const ctr = data && data.impressions > 0
    ? ((data.clicks / data.impressions) * 100).toFixed(1)
    : null;
  const clickoutPct = data && data.clicks > 0
    ? ((data.clickouts / data.clicks) * 100).toFixed(1)
    : null;

  const heading = look ? (look.title || 'This look') : 'Your catalog';

  return (
    <div className="my-cat-analytics-page" role="dialog" aria-modal="true">
      <div className="my-cat-analytics-card my-cat-analytics-card--page">
        <header className="my-cat-analytics-head">
          <h2>{heading}</h2>
          <button type="button" className="my-cat-analytics-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        {/* Time-range pill row — same options for both views. */}
        <div className="my-cat-analytics-range" role="tablist" aria-label="Time range">
          {RANGE_ORDER.map(r => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={range === r}
              className={`my-cat-analytics-range-pill${range === r ? ' is-active' : ''}`}
              onClick={() => setRange(r)}
            >{RANGE_LABELS[r]}</button>
          ))}
        </div>

        {loading ? (
          <div className="my-cat-analytics-empty">Loading…</div>
        ) : !data ? (
          <div className="my-cat-analytics-empty">No analytics yet.</div>
        ) : (
          <>
            <div className="my-cat-analytics-grid">
              <Stat label="Impressions" value={data.impressions.toLocaleString()} />
              <Stat label="Clicks"      value={data.clicks.toLocaleString()} sub={ctr ? `${ctr}% CTR` : undefined} />
              <Stat label="Clickouts"   value={data.clickouts.toLocaleString()} sub={clickoutPct ? `${clickoutPct}% of clicks` : undefined} />
            </div>

            <AnalyticsTrend series={data.series} />

            {!look && data.topLook && (
              <section className="my-cat-analytics-section">
                <h3>Top look</h3>
                <div className="my-cat-analytics-toplook">
                  <span className="my-cat-analytics-toplook-title">{data.topLook.title}</span>
                  <span className="my-cat-analytics-toplook-meta">
                    {data.topLook.impressions.toLocaleString()} impressions · {data.topLook.clicks.toLocaleString()} clicks · {data.topLook.ctr.toFixed(1)}% CTR
                  </span>
                </div>
              </section>
            )}

            {!look && data.topProductsByImpressions.length > 0 && (
              <ProductsSection title="Top products by impressions" rows={data.topProductsByImpressions} unit="impressions" />
            )}
            {!look && data.topProductsByClicks.length > 0 && (
              <ProductsSection title="Top products by clicks" rows={data.topProductsByClicks} unit="clicks" />
            )}
            {!look && data.topProductsByClickouts.length > 0 && (
              <ProductsSection title="Top products by clickouts" rows={data.topProductsByClickouts} unit="clickouts" />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ProductsSection({ title, rows, unit }: { title: string; rows: { name: string; brand: string | null; count: number }[]; unit: string }) {
  return (
    <section className="my-cat-analytics-section">
      <h3>{title}</h3>
      <ol className="my-cat-analytics-list">
        {rows.map((r, i) => (
          <li key={`${title}-${i}`} className="my-cat-analytics-list-row">
            <span className="my-cat-analytics-list-rank">{i + 1}</span>
            <span className="my-cat-analytics-list-name">
              {r.brand && <span className="my-cat-analytics-list-brand">{r.brand}</span>}
              <span>{r.name}</span>
            </span>
            <span className="my-cat-analytics-list-count">{r.count.toLocaleString()} {unit}</span>
          </li>
        ))}
      </ol>
    </section>
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

/** Impressions-over-time trend. A very thin line that draws left→right with
 *  a slow ease-in-out and a pulsing glow at the leading edge. Needs ≥2 points;
 *  renders nothing otherwise. */
function AnalyticsTrend({ series }: { series: { day: string; count: number }[] }) {
  if (!series || series.length < 2) return null;
  const W = 320, H = 60, pad = 5;
  const max = Math.max(...series.map(s => s.count), 1);
  const pts = series.map((s, i) => {
    const x = pad + (i / (series.length - 1)) * (W - pad * 2);
    const y = H - pad - (s.count / max) * (H - pad * 2);
    return [x, y] as const;
  });
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const [ex, ey] = pts[pts.length - 1];
  return (
    <section className="my-cat-analytics-section an-trend">
      <h3>Impressions over time</h3>
      <svg className="an-trend-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Impressions trend">
        <path className="an-trend-line" d={d} pathLength={1} />
        <circle className="an-trend-head" cx={ex} cy={ey} r={2.4} />
      </svg>
    </section>
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
