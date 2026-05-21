
import { useRef, useEffect, useState, useCallback, memo } from 'react';
import { Look, creators } from '~/data/looks';
import { useAuth } from '~/hooks/useAuth';
import { hideLookId } from '~/hooks/useHiddenLooks';
import { useInViewport } from '~/hooks/useInViewport';
import { useTrailVideo } from './TrailVideoHost';
import { lookTrailId, normalizeLookVideoUrl } from '~/utils/trailIds';
import { trackImpression } from '~/services/session-tracker';
import {
  prefetchVideoBytes,
  captureVideoFrame,
  isMobileViewport,
  isSlowConnection,
} from '~/services/video-loading';

// Per-session impression dedupe so a user scrolling past the same
// look five times only counts as one impression (one round trip).
// Lives on module scope so it's shared across every LookCard mount
// in the same tab; reset on a hard reload.
const impressionsLogged = new Set<string>();

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
  /** IntersectionObserver rootMargin for the *active* band — cards inside
   *  this band attach a live <video> element. Default: '50% 0%' (half a
   *  viewport above + below). Cards outside this band but still within the
   *  wider render band fall back to a static poster image, which releases
   *  the video back to the TrailVideoHost pool. Pass a tighter value for
   *  overlay feed sections that share bandwidth with a hero video. */
  rootMargin?: string;
  /** Skip video entirely and render a static poster thumbnail. Use for
   *  overlay feed sections (similar looks, YMAL) where multiple simultaneous
   *  video decoders cause CPU/fan spikes. Card is still tappable. */
  previewOnly?: boolean;
}

// Render band — cards within this margin keep their poster painted but
// drop the video element. Wider than the active band so videos re-attach
// before the user can scroll one back into view.
const RENDER_MARGIN = '200% 0%';

const LookCard = memo(function LookCard({ look, className = 'look-card', onOpenLook, onOpenCreator, onCreateCatalog, hideCreator = false, rootMargin = '50% 0%', previewOnly = false }: LookCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement | null>(null);
  // Poster-first: if the look has a poster image, treat the card as
  // "loaded" immediately so we never flash a shimmer over a perfectly
  // good still image while the MP4 streams in.
  const posterReady = !!(look.thumbnail_url || look.cover);
  const [loaded, setLoaded] = useState(() => previewOnly || posterReady);
  // Active band — close enough to need a live video element.
  const inActiveBand = useInViewport(cardRef, rootMargin);
  // Render band — still on screen-ish, but far enough that we drop the
  // video to free decoder/bandwidth. The card stays in the DOM with its
  // poster so scrolling back is instant (no remount, no layout shift).
  const inRenderBand = useInViewport(cardRef, RENDER_MARGIN);
  // Anything in DOM at all gets the poster painted.
  const inViewport = inActiveBand || inRenderBand;
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
  const fullVideoUrl = normalizeLookVideoUrl(look.video, basePath);
  // Mobile / slow connections get the smaller H.264 480p variant when
  // it exists (mirrors pickVideoUrl() in CreativeCard). Same URL is used
  // by LookOverlay so TrailVideoHost's PoolEntry doesn't re-swap src on
  // handoff (which would force a re-buffer + first-frame black).
  const wantMobile = isMobileViewport() || isSlowConnection();
  const videoUrl = wantMobile && look.mobile_video_url ? look.mobile_video_url : fullVideoUrl;
  // Look thumbnail (server-extracted) → look cover image → empty.
  // Used as the <video poster=> so the card paints a real image while
  // the MP4 streams. Empty string disables the attribute.
  const posterUrl = look.thumbnail_url || look.cover || '';

  // Defer slot population to the *active* viewport band. Outside that
  // band the video is detached and returned to the TrailVideoHost pool —
  // bounded CPU/decoder use no matter how long the infinite feed gets.
  // The LookOverlay hero (same trailId) still reuses the same running
  // <video> on tap — no remount, no first-frame black.
  const videoActive = inActiveBand && !previewOnly;
  const setVideoSlot = useTrailVideo(
    videoActive ? trailId : undefined,
    videoActive ? videoUrl : undefined,
    posterUrl || undefined,
  );

  const setSlot = useCallback((node: HTMLDivElement | null) => {
    slotRef.current = node;
    setVideoSlot(node);
  }, [setVideoSlot]);

  // Emit one impression per session per look the first time the card
  // crosses the viewport. Deduped via a module-scope Set so a user
  // scrolling past the same tile multiple times still counts as one.
  useEffect(() => {
    if (!inViewport) return;
    const key = String(look.id ?? '');
    if (!key || impressionsLogged.has(key)) return;
    impressionsLogged.add(key);
    trackImpression({ type: 'look', id: key, uuid: look.uuid, context: look.title?.slice(0, 200) });
  }, [inViewport, look.id, look.title]);

  // Mark loaded once the host video has frames. If we already have a
  // poster, `loaded` was true from the start — this just keeps things in
  // sync for the rare no-poster path.
  useEffect(() => {
    if (!videoActive) return;
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
  }, [videoActive, trailId]);

  // Phase 8 — Background-warm the HTTP cache while the card sits in the
  // wider render band (2 viewports). By the time the user actually scrolls
  // it into the active band (or taps it for the overlay), the moov atom
  // + first GOP are already cached and the <video> element gets first
  // frame instantly. Mirrors CreativeCard's prefetch and is the single
  // biggest perceived-latency win for cold-tap navigations.
  //
  // Prefetch BOTH the chosen variant and the full-res so the LookOverlay
  // hero (which uses the same chosenUrl) is covered, and any consumer
  // that picks full-res independently still hits the cache.
  useEffect(() => {
    if (!inRenderBand) return;
    if (previewOnly) return;
    const t = window.setTimeout(() => {
      prefetchVideoBytes(videoUrl);
      if (videoUrl !== fullVideoUrl) prefetchVideoBytes(fullVideoUrl);
    }, 500);
    return () => window.clearTimeout(t);
  }, [inRenderBand, previewOnly, videoUrl, fullVideoUrl]);

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
          // Phase 9 — snapshot the currently-playing frame so LookOverlay
          // can paint it as an instant poster behind its hero <video> slot.
          // Eliminates the black flash between card → overlay even when
          // the trail-host hasn't yet swapped the live element across.
          try {
            const video = slotRef.current?.querySelector('video') as HTMLVideoElement | null;
            const frame = captureVideoFrame(video);
            if (frame) {
              const w = window as Window & { __feedTapPosters?: Record<string, string> };
              w.__feedTapPosters = w.__feedTapPosters || {};
              w.__feedTapPosters[trailId] = frame;
            }
          } catch { /* ignore — overlay falls back to thumbnail_url */ }
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
        {/* TrailVideoHost slot — shared <video> hands off to LookOverlay's
            hero on tap via DOM appendChild. No layout morph; the card's
            own video frames stay alive while the overlay opacity-fades in.
            We paint the poster as a CSS background on the slot itself so
            the user sees a real still image instantly — the <video> then
            decodes on top of it. previewOnly and out-of-active-band cards
            skip the video entirely and render poster only. */}
        {previewOnly || !videoActive ? (
          <div
            className="card-video-slot"
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: posterUrl ? `url(${posterUrl})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundColor: look.color || '#111',
            } as React.CSSProperties}
          />
        ) : (
          <div
            ref={setSlot}
            className="card-video-slot"
            data-trail-id={trailId}
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: posterUrl ? `url(${posterUrl})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundColor: look.color || '#111',
            } as React.CSSProperties}
          />
        )}
        <div className="card-gradient" />

        {!hideCreator && (
          <div
            className="card-creator-row"
            onClick={(e) => {
              e.stopPropagation();
              onOpenCreator(look.creator);
            }}
          >
            {(() => {
              const avatar = creatorData?.avatar || look.creatorAvatar || '';
              const name = creatorData?.displayName
                || look.creatorDisplayName
                || (look.creator?.startsWith('user:') ? 'User' : look.creator || '');
              return avatar ? (
                <img className="card-creator-avatar" src={avatar} alt={name} />
              ) : (
                <span className="card-creator-avatar card-creator-avatar--initial" aria-hidden="true">
                  {(name || look.creator || '?').charAt(0).toUpperCase()}
                </span>
              );
            })()}
            <span className="card-creator-name">
              {/* Prefer the static-seed display name, then the look-level
                  fallback emitted by user-published flows. If neither is
                  set and the handle is a raw user:<uuid>, label as
                  "User" so we never leak the uuid into the UI. */}
              {creatorData?.displayName
                || look.creatorDisplayName
                || (look.creator?.startsWith('user:') ? 'User' : look.creator)}
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
