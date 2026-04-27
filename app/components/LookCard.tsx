
import { useRef, useEffect, useState, useCallback, memo } from 'react';
import { Look, creators } from '~/data/looks';
import { useAuth } from '~/hooks/useAuth';
import { hideLookId } from '~/hooks/useHiddenLooks';
import { useTrailVideo } from './TrailVideoHost';
import { TrailMorph } from './TrailMotion';
import { lookTrailId, normalizeLookVideoUrl } from '~/utils/trailIds';

interface LookCardProps {
  look: Look;
  className?: string;
  onOpenLook: (look: Look) => void;
  onOpenCreator: (creatorName: string) => void;
  onCreateCatalog?: (query: string) => void;
}

const LookCard = memo(function LookCard({ look, className = 'look-card', onOpenLook, onOpenCreator, onCreateCatalog }: LookCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [inViewport, setInViewport] = useState(false);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  // Close the admin right-click menu on any outside click or Escape.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const creatorData = creators[look.creator];
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const trailId = lookTrailId(look.id);
  const videoUrl = normalizeLookVideoUrl(look.video, basePath);

  // Defer slot population to viewport. The TrailVideoHost pool keeps the
  // element alive so the LookOverlay hero (same trailId) reuses the same
  // running <video> on tap — no remount, no first-frame black.
  const setVideoSlot = useTrailVideo(
    inViewport ? trailId : undefined,
    inViewport ? videoUrl : undefined,
  );

  const setSlot = useCallback((node: HTMLDivElement | null) => {
    slotRef.current = node;
    setVideoSlot(node);
  }, [setVideoSlot]);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const observer = new IntersectionObserver(
      es => es.forEach(e => setInViewport(e.isIntersecting)),
      { rootMargin: '200px' },
    );
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  // Mark loaded once the host video has frames.
  useEffect(() => {
    if (!inViewport) return;
    const video = slotRef.current?.querySelector('video') as HTMLVideoElement | null;
    if (!video) return;
    if (video.readyState >= 2) { setLoaded(true); return; }
    const handler = () => setLoaded(true);
    ['playing', 'canplay', 'loadeddata'].forEach(evt => video.addEventListener(evt, handler, { once: true }));
    const timeout = setTimeout(() => setLoaded(true), 8000);
    return () => {
      clearTimeout(timeout);
      ['playing', 'canplay', 'loadeddata'].forEach(evt => video.removeEventListener(evt, handler));
    };
  }, [inViewport, trailId]);

  return (
    <div
      ref={cardRef}
      className={`${className} ${loaded ? 'loaded' : ''}`}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('.card-creator-row')) {
          onOpenLook(look);
        }
      }}
      onContextMenu={isAdmin ? (e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      } : undefined}
    >
      <div className="card-inner">
        {!loaded && <div className="card-shimmer" />}
        {/* TrailMorph: layoutId matches LookOverlay's hero — Framer Motion
            morphs the box position on tap. The shared <video> rides along. */}
        <TrailMorph
          id={trailId}
          className="card-video-slot"
          style={{ position: 'absolute', inset: 0 } as React.CSSProperties}
        >
          <div ref={setSlot} className="card-video-slot-inner" style={{ width: '100%', height: '100%' }} data-trail-id={trailId} />
        </TrailMorph>
        <div className="card-gradient" />
        {onCreateCatalog && (
          <button
            className="card-catalog-btn"
            onClick={(e) => {
              e.stopPropagation();
              onCreateCatalog(look.creator);
            }}
            aria-label="Create catalog from this look"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
          </button>
        )}

        <div
          className="card-creator-row"
          onClick={(e) => {
            e.stopPropagation();
            onOpenCreator(look.creator);
          }}
        >
          <img
            className="card-creator-avatar"
            src={creatorData?.avatar || ''}
            alt={look.creator}
          />
          <span className="card-creator-name">
            {creatorData?.displayName || look.creator}
          </span>
        </div>
      </div>
      {menu && isAdmin && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: menu.x,
            top: menu.y,
            zIndex: 10000,
            background: '#1a1a1a',
            color: '#fff',
            borderRadius: 8,
            padding: 4,
            minWidth: 160,
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            border: '1px solid #333',
            fontSize: 13,
          }}
        >
          <button
            onClick={async (e) => {
              e.stopPropagation();
              setMenu(null);
              await hideLookId(look.id);
            }}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              color: '#fca5a5',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#2a1616'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
            Delete look (admin)
          </button>
        </div>
      )}
    </div>
  );
});

export default LookCard;
