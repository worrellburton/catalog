// CreativeCardV2 — director-driven variant of CreativeCard.
//
// Key differences from CreativeCard:
//   - No <video> JSX / videoRef. The director appends a pooled <video>
//     element into the card div when this card is in the top-K nearest
//     to viewport center.
//   - No 1-second heartbeat useEffect (was lines ~93-110 in CreativeCard).
//   - No prefetchVideoBytes call on viewport dwell.
//   - No crossOrigin="anonymous" default.
//   - Uses useDirectorSlot for playback control.
//   - captureVideoFrame reads from director.getVideoElement() instead
//     of a component-owned ref.
//   - Small debug badge (status colour) in top-right corner.
//     Remove before promoting to production.

import { useRef, useEffect, useState, useCallback, memo } from 'react';
import {
  trackAdImpression,
  trackAdClick,
  prefetchSimilarCreatives,
  type ProductAd,
} from '~/services/product-creative';
import {
  pickVideoUrl,
  pickPosterUrl,
  pickStillImageUrl,
  captureVideoFrame,
  markFeedMilestone,
} from '~/services/video-loading';
import { director } from '~/services/video-playback-director';
import { useAuth } from '~/hooks/useAuth';
import { useDirectorSlot } from '~/hooks/useDirectorSlot';
import { useVideoStillRatio } from '~/hooks/useVideoStillRatio';
import { shouldBeVideo } from '~/utils/videoStillSplit';

interface CreativeCardV2Props {
  creative: ProductAd;
  className?: string;
  onOpenProduct?: (creative: ProductAd) => void;
  canDelete?: boolean;
  onDelete?: (id: string) => void;
  /** Above-the-fold cards get eager poster fetch. */
  priority?: boolean;
  /** Override the director slot ID (use when the same creative appears multiple times). */
  slotId?: string;
}

const CreativeCardV2 = memo(function CreativeCardV2({
  creative,
  className = 'look-card',
  onOpenProduct,
  canDelete,
  onDelete,
  priority = false,
  slotId,
}: CreativeCardV2Props) {
  const posterUrl = pickPosterUrl(creative);
  const playableUrl = pickVideoUrl(creative);

  // Dial: /admin/dials → video_still_ratio controls whether this card
  // renders as a still image or plays video. When the dial pushes the
  // card into still mode we show the retail product photo (higher
  // merchandising quality than the auto-extracted thumbnail) and skip
  // the director entirely. On mouse-enter the card upgrades to video.
  const globalVideoRatio = useVideoStillRatio();
  const dialPrefersVideo = shouldBeVideo(creative.id, globalVideoRatio);
  const stillImageUrl = pickStillImageUrl(creative);
  const renderAsStill = !dialPrefersVideo && !!stillImageUrl;

  // Hover-to-play: when in still mode, a mouseenter activates video for
  // this card. Stays active for the session — no revert on mouseleave.
  const [hoverPlaying, setHoverPlaying] = useState(false);

  // Director only receives the video URL when we want it to play.
  // Passing null keeps the card unregistered (still-only path).
  const activeVideoUrl = (!renderAsStill || hoverPlaying) ? playableUrl : null;

  // Poster-first: if we have a still image, skip the shimmer entirely.
  // The shimmer is only useful as a loading skeleton when there is nothing
  // to show yet — with a poster we already have pixels to display.
  const [loaded, setLoaded] = useState(() => !!posterUrl);
  const impressionTracked = useRef(false);
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  // Use slotId when provided (e.g. duplicate positions in infinite feed),
  // otherwise fall back to the creative's own id.
  const directorId = slotId ?? creative.id;

  // Wire to the director. containerRef goes on the card div — the
  // director will appendChild a pooled <video> here when promoted to top-K.
  // activeVideoUrl is null in still mode, so the director skips this card.
  const { containerRef, status } = useDirectorSlot(
    directorId,
    activeVideoUrl,
    posterUrl,
  );

  // Remove shimmer as soon as the director has assigned a video element
  // (status 'loading' = play() in-flight, video appended to DOM).
  // We don't wait for 'playing' — the video poster is visible the instant
  // the element mounts, so the shimmer is redundant from that point on.
  useEffect(() => {
    if (status === 'loading' || status === 'playing') {
      setLoaded(true);
      if (status === 'playing') markFeedMilestone(`first-frame:${directorId}`);
    }
  }, [status, directorId]);

  // Impression tracking — fire once on first promotion (status moves off idle).
  useEffect(() => {
    if (status !== 'idle' && !impressionTracked.current) {
      impressionTracked.current = true;
      trackAdImpression(creative.id);
    }
  }, [status, creative.id]);

  const handleClick = useCallback(() => {
    trackAdClick(creative.id);
    // Capture the playing frame for the detail-view hero handoff.
    // director.getVideoElement() returns the pooled element if assigned.
    const frame = captureVideoFrame(director.getVideoElement(directorId));
    if (frame) {
      try {
        const w = window as Window & { __feedTapPosters?: Record<string, string> };
        w.__feedTapPosters = w.__feedTapPosters || {};
        w.__feedTapPosters[creative.id] = frame;
      } catch { /* ignore */ }
    }
    if (onOpenProduct) {
      onOpenProduct(creative);
    } else if (creative.affiliate_url) {
      window.open(creative.affiliate_url, '_blank', 'noopener');
    } else if (creative.product?.url) {
      window.open(creative.product.url, '_blank', 'noopener');
    }
  }, [creative, onOpenProduct]);

  // Hover/touch-start prefetch for the "More like this" rail.
  const handlePrefetch = useCallback(() => {
    if (creative.id) prefetchSimilarCreatives(creative.id, 18);
  }, [creative.id]);

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
      try {
        (navigator as Navigator & { vibrate?: (n: number) => void }).vibrate?.(10);
      } catch { /* ignore */ }
    }, 500);
  }, [isSuperAdmin]);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

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

  return (
    <div
      ref={containerRef}
      className={`${className} promo-card ${loaded ? 'loaded' : ''}`}
      style={{ position: 'relative', overflow: 'hidden' }}
      onClick={(e) => {
        if (longPressFired.current) {
          longPressFired.current = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        handleClick();
      }}
      onMouseEnter={() => {
        handlePrefetch();
        if (renderAsStill && !hoverPlaying) setHoverPlaying(true);
      }}
      onTouchStart={(e) => { handlePrefetch(); beginLongPress(e); }}
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

        {/* Static poster — visible behind the video while the director
            hasn't yet assigned a pool element (status='idle'/'paused').
            In still mode, shows the retail product image (stillImageUrl)
            instead of the video thumbnail for better merchandising quality. */}
        {(renderAsStill ? stillImageUrl : posterUrl) && (
          <img
            className="card-poster"
            src={renderAsStill && !hoverPlaying ? stillImageUrl : posterUrl ?? undefined}
            alt=""
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            {...(priority ? { fetchpriority: 'high' as const } : {})}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: 'cover', zIndex: 1,
            } as React.CSSProperties}
          />
        )}

        {/* Director appends the pooled <video> element here at zIndex 2.
            No <video> JSX — the director owns the element lifecycle. */}

        <div className="card-gradient" />

        {canDelete && onDelete && (
          <button
            type="button"
            className="creative-delete-btn"
            aria-label="Delete product"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete product "${creative.product?.name || 'this product'}" everywhere?`)) {
                onDelete(creative.id);
              }
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
        )}

        <div className="promo-product-info">
          <div className="promo-product-text">
            {creative.product?.brand && (
              <span className="promo-product-brand">{creative.product.brand}</span>
            )}
            <span className="promo-product-name">
              {creative.product?.name || 'Shop Now'}
            </span>
          </div>
          {creative.product?.price && (
            <span className="promo-product-price">{creative.product.price}</span>
          )}
        </div>
      </div>

      {menu && isSuperAdmin && (
        <div
          className="trail-admin-menu"
          onClick={(e) => e.stopPropagation()}
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            type="button"
            className="trail-admin-menu-btn trail-admin-menu-btn--danger"
            onClick={(e) => {
              e.stopPropagation();
              setMenu(null);
              if (onDelete && confirm(`Delete product "${creative.product?.name || 'this product'}" everywhere?`)) {
                onDelete(creative.id);
              }
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
            Delete product
          </button>
        </div>
      )}

    </div>
  );
});

export default CreativeCardV2;
