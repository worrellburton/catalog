
import { useRef, useEffect, useState, useCallback, memo } from 'react';
import { Look, creators } from '~/data/looks';
import { useAuth } from '~/hooks/useAuth';
import { hideLookId } from '~/hooks/useHiddenLooks';
import { useInViewport } from '~/hooks/useInViewport';
import { useTrailVideo } from './TrailVideoHost';
import { lookTrailId, normalizeLookVideoUrl } from '~/utils/trailIds';

interface LookCardProps {
  look: Look;
  className?: string;
  onOpenLook: (look: Look) => void;
  onOpenCreator: (creatorName: string) => void;
  onCreateCatalog?: (query: string) => void;
  /** Hide the creator avatar+name row on the tile. Used by the Creator
   *  Catalog page where the creator identity is already in the page
   *  header - per-tile attribution is redundant noise there. */
  hideCreator?: boolean;
}

const LookCard = memo(function LookCard({ look, className = 'look-card', onOpenLook, onOpenCreator, onCreateCatalog, hideCreator = false }: LookCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const inViewport = useInViewport(cardRef);
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  const beginLongPress = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (!isSuperAdmin) return;
    longPressFired.current = false;
    const isTouch = 'touches' in e;
    if (isTouch && e.touches.length !== 1) return;
    const x = isTouch ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const y = isTouch ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      setMenu({ x, y });
      try { (navigator as Navigator & { vibrate?: (n: number) => void }).vibrate?.(10); } catch {}
    }, 500);
  }, [isSuperAdmin]);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

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
  // Look thumbnail (server-extracted) → look cover image → empty.
  // Used as the <video poster=> so the card paints a real image while
  // the MP4 streams. Empty string disables the attribute.
  const posterUrl = look.thumbnail_url || look.cover || '';

  // Defer slot population to viewport. The TrailVideoHost pool keeps the
  // element alive so the LookOverlay hero (same trailId) reuses the same
  // running <video> on tap - no remount, no first-frame black.
  const setVideoSlot = useTrailVideo(
    inViewport ? trailId : undefined,
    inViewport ? videoUrl : undefined,
    posterUrl || undefined,
  );

  const setSlot = useCallback((node: HTMLDivElement | null) => {
    slotRef.current = node;
    setVideoSlot(node);
  }, [setVideoSlot]);

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
      data-present-id={`card:${look.id}`}
      onClick={(e) => {
        if (longPressFired.current) {
          longPressFired.current = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (!(e.target as HTMLElement).closest('.card-creator-row')) {
          onOpenLook(look);
        }
      }}
      onTouchStart={beginLongPress}
      onTouchEnd={cancelLongPress}
      onTouchMove={cancelLongPress}
      onTouchCancel={cancelLongPress}
      onMouseDown={beginLongPress}
      onMouseUp={cancelLongPress}
      onMouseLeave={cancelLongPress}
      onContextMenu={isSuperAdmin ? (e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      } : undefined}
    >
      <div className="card-inner">
        {!loaded && <div className="card-shimmer" />}
        {/* TrailVideoHost slot - shared <video> hands off to LookOverlay's
            hero on tap via DOM appendChild. No layout morph; the card's
            own video frames stay alive while the overlay opacity-fades in. */}
        <div
          ref={setSlot}
          className="card-video-slot"
          data-trail-id={trailId}
          style={{ position: 'absolute', inset: 0 } as React.CSSProperties}
        />
        <div className="card-gradient" />

        {!hideCreator && (
          <div
            className="card-creator-row"
            onClick={(e) => {
              e.stopPropagation();
              onOpenCreator(look.creator);
            }}
          >
            <img
              className="card-creator-avatar"
              src={creatorData?.avatar || look.creatorAvatar || ''}
              alt={creatorData?.displayName || look.creatorDisplayName || ''}
            />
            <span className="card-creator-name">
              {/* Prefer the static-seed display name, then the look-level
                  fallback emitted by user-published flows. If neither is
                  set and the handle is a raw user:<uuid>, hide it - the
                  uuid is noise in the UI. */}
              {creatorData?.displayName
                || look.creatorDisplayName
                || (look.creator?.startsWith('user:') ? '' : look.creator)}
            </span>
          </div>
        )}
      </div>
      {menu && isSuperAdmin && (
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
