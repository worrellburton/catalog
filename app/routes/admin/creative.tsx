import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { getGeneratedVideos, deleteGeneratedVideo, setGeneratedVideoElite, type GeneratedVideo } from '~/services/video-generation';
import { getProductAds, deleteProductAd, setAdElite, type ProductAd } from '~/services/product-ads';

// One tile's video. Plays only while the tile is on-screen so we aren't
// running 170 decoders simultaneously. We keep the src bound so metadata
// stays loaded and tile heights don't jump on scroll — just pause / resume.
const VideoTile = memo(function VideoTile({ src, muted }: { src: string; muted: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.play().catch(() => { /* autoplay can reject until the user interacts */ });
          } else {
            el.pause();
          }
        }
      },
      { rootMargin: '200px 0px', threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <video
      ref={ref}
      src={src}
      loop
      muted={muted}
      playsInline
      preload="metadata"
      draggable={false}
      style={{ width: '100%', height: 'auto', display: 'block', pointerEvents: 'none' }}
    />
  );
});

interface GalleryVideo {
  id: string;
  source: 'look' | 'product';
  video_url: string;
  label: string;
  sublabel: string;
  style: string;
  status: string;
  created_at: string;
  // A/B variant metadata (only for product ads)
  product_id?: string;
  impressions?: number;
  clicks?: number;
  ctr?: number;
  is_elite: boolean;
}

const VARIANT_MIN_IMPRESSIONS = 500;

function toGallery(videos: GeneratedVideo[], ads: ProductAd[]): GalleryVideo[] {
  const v: GalleryVideo[] = videos
    .filter(x => x.video_url)
    .map(x => ({
      id: x.id,
      source: 'look',
      video_url: x.video_url as string,
      label: x.product?.name || 'Look video',
      sublabel: x.product?.brand || x.ai_model?.name || '',
      style: x.style,
      status: x.status,
      created_at: x.created_at,
      product_id: x.product_id,
      is_elite: !!x.is_elite,
    }));
  const a: GalleryVideo[] = ads
    .filter(x => x.video_url)
    .map(x => {
      const impressions = x.impressions || 0;
      const clicks = x.clicks || 0;
      return {
        id: x.id,
        source: 'product' as const,
        video_url: x.video_url as string,
        label: x.product?.name || x.title || 'Product ad',
        sublabel: x.product?.brand || '',
        style: x.style,
        status: x.status,
        created_at: x.created_at,
        product_id: x.product_id,
        impressions,
        clicks,
        ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
        is_elite: !!x.is_elite,
      };
    });
  return [...v, ...a].sort((x, y) => new Date(y.created_at).getTime() - new Date(x.created_at).getTime());
}

// For each product+style variant group with ≥ 2 entries and every variant having
// the min impression threshold, return the winner id.
function computeWinners(gallery: GalleryVideo[]): Set<string> {
  const groups = new Map<string, GalleryVideo[]>();
  gallery.forEach(v => {
    if (v.source !== 'product' || !v.product_id) return;
    const key = `${v.product_id}|${v.style}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(v);
  });
  const winners = new Set<string>();
  groups.forEach(variants => {
    if (variants.length < 2) return;
    if (!variants.every(v => (v.impressions || 0) >= VARIANT_MIN_IMPRESSIONS)) return;
    const best = variants.reduce((a, b) => (b.ctr || 0) > (a.ctr || 0) ? b : a);
    winners.add(best.id);
  });
  return winners;
}

type FilterTab = 'all' | 'product' | 'look';

const selectionKey = (v: GalleryVideo) => `${v.source}:${v.id}`;

const DRAG_THRESHOLD = 5;

export default function AdminCreative() {
  const [videos, setVideos] = useState<GalleryVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [muted, setMuted] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [cols, setCols] = useState(6); // controlled by the bottom zoom slider
  const [search, setSearch] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Drag-to-select marquee state
  const gridRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const dragBaseSelection = useRef<Set<string>>(new Set());
  const dragAdditive = useRef<boolean>(false);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const loadAll = () => {
    setLoading(true);
    Promise.all([getGeneratedVideos(), getProductAds()]).then(([v, a]) => {
      setVideos(toGallery(v, a));
      setLoading(false);
    });
  };

  useEffect(() => { loadAll(); }, []);

  const filtered = (() => {
    let list = filter === 'all' ? videos : videos.filter(v => v.source === filter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(v =>
        v.label.toLowerCase().includes(q) ||
        v.sublabel.toLowerCase().includes(q) ||
        v.style.toLowerCase().includes(q)
      );
    }
    return list;
  })();

  const winners = computeWinners(videos);

  const toggle = (v: GalleryVideo) => {
    setSelected(prev => {
      const next = new Set(prev);
      const k = selectionKey(v);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());
  const selectAll = () => setSelected(new Set(filtered.map(selectionKey)));

  const requestDelete = () => {
    if (selected.size === 0) return;
    setShowDeleteConfirm(true);
  };

  const toggleElite = async (v: GalleryVideo) => {
    const next = !v.is_elite;
    // Optimistic update — the marquee redraws every frame, so waiting on the
    // round-trip makes the button feel laggy when clicking through a batch.
    setVideos(prev => prev.map(x =>
      x.id === v.id && x.source === v.source ? { ...x, is_elite: next } : x
    ));
    const { error } = v.source === 'product'
      ? await setAdElite(v.id, v.product_id || '', next)
      : await setGeneratedVideoElite(v.id, v.product_id || null, next);
    if (error) {
      console.error('[creative] toggle elite failed:', error);
      setVideos(prev => prev.map(x =>
        x.id === v.id && x.source === v.source ? { ...x, is_elite: !next } : x
      ));
    }
  };

  const confirmDelete = async () => {
    if (selected.size === 0) return;
    setShowDeleteConfirm(false);
    setDeleting(true);
    const keys = Array.from(selected);
    await Promise.all(keys.map(async k => {
      const [source, id] = k.split(':');
      if (source === 'product') await deleteProductAd(id);
      else await deleteGeneratedVideo(id);
    }));
    setSelected(new Set());
    setDeleting(false);
    loadAll();
  };

  // Marquee selection handlers
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // Don't start marquee drag if clicking directly on a button
    if (target.closest('button')) return;
    const grid = gridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    dragStart.current = {
      x: e.clientX - rect.left + grid.scrollLeft,
      y: e.clientY - rect.top + grid.scrollTop,
    };
    dragBaseSelection.current = new Set(selected);
    dragAdditive.current = e.shiftKey || e.metaKey || e.ctrlKey;
  }, [selected]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragStart.current) return;
    const grid = gridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const cx = e.clientX - rect.left + grid.scrollLeft;
    const cy = e.clientY - rect.top + grid.scrollTop;
    const dx = cx - dragStart.current.x;
    const dy = cy - dragStart.current.y;

    if (!isDragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!isDragging) setIsDragging(true);

    const x = Math.min(dragStart.current.x, cx);
    const y = Math.min(dragStart.current.y, cy);
    const w = Math.abs(dx);
    const h = Math.abs(dy);
    setMarquee({ x, y, w, h });

    // Compute intersected tiles
    const tiles = grid.querySelectorAll<HTMLElement>('[data-tile-key]');
    const intersected = new Set<string>();
    tiles.forEach(el => {
      const tRect = el.getBoundingClientRect();
      const tx = tRect.left - rect.left + grid.scrollLeft;
      const ty = tRect.top - rect.top + grid.scrollTop;
      const overlap =
        tx < x + w && tx + tRect.width > x &&
        ty < y + h && ty + tRect.height > y;
      if (overlap) {
        const k = el.getAttribute('data-tile-key');
        if (k) intersected.add(k);
      }
    });

    if (dragAdditive.current) {
      const merged = new Set(dragBaseSelection.current);
      intersected.forEach(k => merged.add(k));
      setSelected(merged);
    } else {
      setSelected(intersected);
    }
  }, [isDragging]);

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    if (!dragStart.current) return;
    const wasDragging = isDragging;
    dragStart.current = null;
    setMarquee(null);
    setIsDragging(false);
    if (!wasDragging) {
      // Treat as click — find the tile clicked and toggle
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tile-key]');
      if (el) {
        const k = el.getAttribute('data-tile-key');
        if (k) {
          setSelected(prev => {
            const next = new Set(prev);
            if (next.has(k)) next.delete(k); else next.add(k);
            return next;
          });
        }
      }
    }
  }, [isDragging]);

  const onMouseLeave = useCallback(() => {
    if (!dragStart.current) return;
    dragStart.current = null;
    setMarquee(null);
    setIsDragging(false);
  }, []);

  // Keyboard shortcuts: Escape exits fullscreen; Cmd/Ctrl+Delete triggers delete confirm
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showDeleteConfirm) setShowDeleteConfirm(false);
        else if (fullscreen) setFullscreen(false);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'Backspace' || e.key === 'Delete')) {
        const active = document.activeElement as HTMLElement | null;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
        if (selected.size === 0) return;
        e.preventDefault();
        setShowDeleteConfirm(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen, selected.size, showDeleteConfirm]);

  const content = (
    <>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 8,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: fullscreen ? 20 : 28, fontWeight: 700 }}>Creative</h1>
          {!fullscreen && (
            <p className="admin-page-subtitle" style={{ margin: '4px 0 0' }}>
              Every AI-generated video on the platform, playing live
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="search"
            placeholder="Search by brand, product, style…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid #ddd',
              fontSize: 12,
              minWidth: 260,
              background: '#fff',
            }}
          />
          <button
            className="admin-btn admin-btn-secondary"
            onClick={() => setMuted(m => !m)}
            title={muted ? 'Unmute all' : 'Mute all'}
          >
            {muted ? '🔇 Muted' : '🔊 Unmuted'}
          </button>
          <button
            className="admin-btn admin-btn-secondary"
            onClick={() => setFullscreen(f => !f)}
            title={fullscreen ? 'Exit fullscreen (Esc)' : 'Enter fullscreen'}
          >
            {fullscreen ? '⤓ Exit fullscreen' : '⤢ Fullscreen'}
          </button>
        </div>
      </div>

      {!fullscreen && (
        <div style={{ display: 'flex', gap: 20, padding: '10px 0', marginBottom: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>{videos.length}</span>
            <span style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Videos</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>{videos.filter(v => v.source === 'product').length}</span>
            <span style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Product Ads</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>{videos.filter(v => v.source === 'look').length}</span>
            <span style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Look Videos</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#b88600' }}>{videos.filter(v => v.is_elite).length}</span>
            <span style={{ fontSize: 11, color: '#b88600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>★ Elite</span>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <div className="admin-tabs" style={{ marginBottom: 0 }}>
          <button className={`admin-tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
            All <span className="admin-tab-badge">{videos.length}</span>
          </button>
          <button className={`admin-tab ${filter === 'product' ? 'active' : ''}`} onClick={() => setFilter('product')}>
            Products <span className="admin-tab-badge">{videos.filter(v => v.source === 'product').length}</span>
          </button>
          <button className={`admin-tab ${filter === 'look' ? 'active' : ''}`} onClick={() => setFilter('look')}>
            Looks <span className="admin-tab-badge">{videos.filter(v => v.source === 'look').length}</span>
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {selected.size > 0 ? (
            <>
              <span style={{ fontSize: 13, color: '#666' }}>{selected.size} selected</span>
              <button className="admin-btn admin-btn-secondary" onClick={clearSelection} disabled={deleting}>
                Clear
              </button>
              <button
                className="admin-btn admin-btn-primary"
                style={{ background: '#dc2626', borderColor: '#dc2626' }}
                onClick={requestDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : `Delete ${selected.size}`}
              </button>
            </>
          ) : (
            <button className="admin-btn admin-btn-secondary" onClick={selectAll}>
              Select all
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="admin-empty">Loading creative library…</div>
      ) : filtered.length === 0 ? (
        <div className="admin-empty">No videos yet.</div>
      ) : (
        <div
          ref={gridRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
          style={{
            position: 'relative',
            // CSS columns → masonry layout. Each tile keeps its natural
            // aspect and stacks vertically within a column; the zoom slider
            // changes column count so tiles get bigger / smaller.
            columnCount: cols,
            columnGap: 8,
            userSelect: 'none',
            flex: fullscreen ? 1 : undefined,
            overflow: fullscreen ? 'auto' : undefined,
            minHeight: 0,
            paddingBottom: 72, // leave room for the bottom slider bar
          }}
        >
          {filtered.map(v => {
            const k = selectionKey(v);
            const isSelected = selected.has(k);
            const isWinner = winners.has(v.id);
            return (
              <div
                key={k}
                data-tile-key={k}
                style={{
                  position: 'relative',
                  breakInside: 'avoid',
                  marginBottom: 8,
                  borderRadius: 6,
                  overflow: 'hidden',
                  background: '#000',
                  boxShadow: isSelected
                    ? '0 0 0 3px #3b82f6, 0 1px 3px rgba(0,0,0,0.12)'
                    : isWinner
                      ? '0 0 0 2px #16a34a, 0 1px 3px rgba(0,0,0,0.12)'
                      : '0 1px 3px rgba(0,0,0,0.12)',
                  cursor: 'pointer',
                  transition: 'box-shadow 0.15s',
                }}
              >
                <VideoTile src={v.video_url} muted={muted} />
                <div style={{ position: 'absolute', top: 4, left: 4, display: 'flex', gap: 4, pointerEvents: 'none' }}>
                  <div
                    style={{
                      padding: '2px 5px',
                      borderRadius: 3,
                      fontSize: 9,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      background: v.source === 'product' ? 'rgba(59,130,246,0.9)' : 'rgba(139,92,246,0.9)',
                      color: '#fff',
                    }}
                  >
                    {v.source}
                  </div>
                  {isWinner && (
                    <div
                      style={{
                        padding: '2px 5px',
                        borderRadius: 3,
                        fontSize: 9,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        background: 'rgba(22,163,74,0.95)',
                        color: '#fff',
                      }}
                      title={`Winner — ${(v.ctr || 0).toFixed(2)}% CTR over ${(v.impressions || 0).toLocaleString()} impressions`}
                    >
                      🏆 Winner
                    </div>
                  )}
                  {v.is_elite && (
                    <div
                      style={{
                        padding: '2px 5px',
                        borderRadius: 3,
                        fontSize: 9,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        background: 'rgba(234,179,8,0.95)',
                        color: '#111',
                      }}
                      title="Shown in deck v1.1 background feed"
                    >
                      ★ Elite
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onMouseDown={e => e.stopPropagation()}
                  onClick={e => {
                    e.stopPropagation();
                    toggleElite(v);
                  }}
                  title={v.is_elite ? 'Remove from deck v1.1 elite feed' : 'Mark creative + product as elite (shown in deck v1.1)'}
                  style={{
                    position: 'absolute',
                    bottom: 6,
                    right: 6,
                    padding: '4px 8px',
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.5px',
                    textTransform: 'uppercase',
                    border: v.is_elite ? '1px solid rgba(234,179,8,1)' : '1px solid rgba(255,255,255,0.6)',
                    background: v.is_elite ? 'rgba(234,179,8,0.95)' : 'rgba(0,0,0,0.55)',
                    color: v.is_elite ? '#111' : '#fff',
                    cursor: 'pointer',
                    zIndex: 2,
                    backdropFilter: 'blur(4px)',
                  }}
                >
                  {v.is_elite ? '★ Elite' : 'Elite'}
                </button>
                <div
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: isSelected ? '#3b82f6' : 'rgba(0,0,0,0.4)',
                    border: `2px solid ${isSelected ? '#3b82f6' : 'rgba(255,255,255,0.7)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                  }}
                >
                  {isSelected && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                {cols <= 8 && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      padding: '12px 6px 6px',
                      background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
                      color: '#fff',
                      pointerEvents: 'none',
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.label}
                    </div>
                    {v.sublabel && (
                      <div style={{ fontSize: 9, opacity: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {v.sublabel}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {marquee && (
            <div
              style={{
                position: 'absolute',
                left: marquee.x,
                top: marquee.y,
                width: marquee.w,
                height: marquee.h,
                border: '1.5px solid #3b82f6',
                background: 'rgba(59,130,246,0.15)',
                pointerEvents: 'none',
                borderRadius: 2,
                zIndex: 10,
              }}
            />
          )}
        </div>
      )}

      {/* Bottom zoom slider — controls column count for the masonry layout.
          Higher = more columns = smaller tiles = see more at once. */}
      {filtered.length > 0 && (
        <div
          style={{
            position: fullscreen ? 'fixed' : 'sticky',
            bottom: fullscreen ? 20 : 16,
            left: fullscreen ? '50%' : 'auto',
            transform: fullscreen ? 'translateX(-50%)' : undefined,
            margin: fullscreen ? 0 : '0 auto',
            maxWidth: 420,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 16px',
            background: 'rgba(20, 20, 20, 0.88)',
            color: '#fff',
            borderRadius: 999,
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            backdropFilter: 'blur(10px)',
            zIndex: 50,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Fewer columns">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
          <input
            type="range"
            min={2}
            max={24}
            step={1}
            value={cols}
            onChange={e => setCols(Number(e.target.value))}
            style={{ flex: 1, accentColor: '#3b82f6', cursor: 'pointer' }}
          />
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="More columns">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', minWidth: 18, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{cols}</span>
        </div>
      )}

      {showDeleteConfirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: 12,
              width: 440,
              maxWidth: '92vw',
              padding: 24,
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: '#fef2f2',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#dc2626',
                  fontSize: 22,
                  fontWeight: 700,
                }}
              >
                !
              </div>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#111' }}>Warning — hard delete</h2>
            </div>
            <p style={{ margin: '0 0 6px', fontSize: 13, color: '#444', lineHeight: 1.5 }}>
              This will <strong>permanently delete {selected.size} video{selected.size === 1 ? '' : 's'}</strong> from the database and storage.
            </p>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: '#888' }}>
              This action cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                className="admin-btn admin-btn-secondary"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
              >
                No, cancel
              </button>
              <button
                className="admin-btn admin-btn-primary"
                style={{ background: '#dc2626', borderColor: '#dc2626' }}
                onClick={confirmDelete}
                disabled={deleting}
              >
                Yes, delete permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  if (fullscreen) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: '#fff',
          zIndex: 9998,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {content}
      </div>
    );
  }

  return <div className="admin-page">{content}</div>;
}
