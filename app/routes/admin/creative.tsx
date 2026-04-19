import { useState, useEffect } from 'react';
import { getGeneratedVideos, deleteGeneratedVideo, type GeneratedVideo } from '~/services/video-generation';
import { getProductAds, deleteProductAd, type ProductAd } from '~/services/product-ads';

interface GalleryVideo {
  id: string;
  source: 'look' | 'product';
  video_url: string;
  label: string;
  sublabel: string;
  style: string;
  status: string;
  created_at: string;
}

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
    }));
  const a: GalleryVideo[] = ads
    .filter(x => x.video_url)
    .map(x => ({
      id: x.id,
      source: 'product',
      video_url: x.video_url as string,
      label: x.product?.name || x.title || 'Product ad',
      sublabel: x.product?.brand || '',
      style: x.style,
      status: x.status,
      created_at: x.created_at,
    }));
  return [...v, ...a].sort((x, y) => new Date(y.created_at).getTime() - new Date(x.created_at).getTime());
}

type FilterTab = 'all' | 'product' | 'look';

const selectionKey = (v: GalleryVideo) => `${v.source}:${v.id}`;

export default function AdminCreative() {
  const [videos, setVideos] = useState<GalleryVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [muted, setMuted] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const loadAll = () => {
    setLoading(true);
    Promise.all([getGeneratedVideos(), getProductAds()]).then(([v, a]) => {
      setVideos(toGallery(v, a));
      setLoading(false);
    });
  };

  useEffect(() => { loadAll(); }, []);

  const filtered = filter === 'all' ? videos : videos.filter(v => v.source === filter);

  const toggle = (v: GalleryVideo) => {
    setSelected(prev => {
      const next = new Set(prev);
      const k = selectionKey(v);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const handleDelete = async () => {
    if (selected.size === 0) return;
    const n = selected.size;
    if (!confirm(`Delete ${n} video${n === 1 ? '' : 's'}? This cannot be undone.`)) return;
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

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1>Creative</h1>
          <p className="admin-page-subtitle">Every AI-generated video on the platform, playing live</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="admin-btn admin-btn-secondary"
            onClick={() => setMuted(m => !m)}
            title={muted ? 'Unmute all' : 'Mute all'}
          >
            {muted ? '🔇 Muted' : '🔊 Unmuted'}
          </button>
        </div>
      </div>

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
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12 }}>
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
        {selected.size > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#666' }}>{selected.size} selected</span>
            <button className="admin-btn admin-btn-secondary" onClick={clearSelection} disabled={deleting}>
              Clear
            </button>
            <button
              className="admin-btn admin-btn-primary"
              style={{ background: '#dc2626', borderColor: '#dc2626' }}
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : `Delete ${selected.size}`}
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="admin-empty">Loading creative library…</div>
      ) : filtered.length === 0 ? (
        <div className="admin-empty">No videos yet.</div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 12,
          }}
        >
          {filtered.map(v => {
            const k = selectionKey(v);
            const isSelected = selected.has(k);
            return (
              <div
                key={k}
                onClick={() => toggle(v)}
                style={{
                  position: 'relative',
                  aspectRatio: '9 / 16',
                  borderRadius: 8,
                  overflow: 'hidden',
                  background: '#000',
                  boxShadow: isSelected
                    ? '0 0 0 3px #3b82f6, 0 1px 3px rgba(0,0,0,0.12)'
                    : '0 1px 3px rgba(0,0,0,0.12)',
                  cursor: 'pointer',
                  transition: 'box-shadow 0.15s',
                }}
              >
                <video
                  src={v.video_url}
                  autoPlay
                  loop
                  muted={muted}
                  playsInline
                  preload="metadata"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: 6,
                    left: 6,
                    padding: '2px 6px',
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    background: v.source === 'product' ? 'rgba(59,130,246,0.9)' : 'rgba(139,92,246,0.9)',
                    color: '#fff',
                  }}
                >
                  {v.source}
                </div>
                <div
                  style={{
                    position: 'absolute',
                    top: 6,
                    right: 6,
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: isSelected ? '#3b82f6' : 'rgba(0,0,0,0.4)',
                    border: `2px solid ${isSelected ? '#3b82f6' : 'rgba(255,255,255,0.7)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {isSelected && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    padding: '16px 8px 8px',
                    background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
                    color: '#fff',
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {v.label}
                  </div>
                  {v.sublabel && (
                    <div style={{ fontSize: 10, opacity: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.sublabel}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
