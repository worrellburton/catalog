import { useRef, useEffect, useState, useCallback, memo } from 'react';
import { trackAdImpression, trackAdClick, prefetchSimilarProducts, type ProductAd } from '~/services/product-creative';
import {
  pickVideoUrl,
  pickPosterUrl,
  pickStillImageUrl,
  prefetchVideoBytes,
  captureVideoFrame,
  markFeedMilestone,
  isMobileViewport,
} from '~/services/video-loading';
import { useAuth } from '~/hooks/useAuth';
import { useInViewport } from '~/hooks/useInViewport';
import { useVideoStillRatio } from '~/hooks/useVideoStillRatio';
import { shouldBeVideo } from '~/utils/videoStillSplit';

interface CreativeCardProps {
  creative: ProductAd;
  className?: string;
  onOpenProduct?: (creative: ProductAd) => void;
  canDelete?: boolean;
  onDelete?: (id: string) => void;
  /** Above-the-fold cards. Tells the browser to fetch the poster image
   *  eagerly with high priority so the first paint of real content
   *  beats the network round-trip for off-screen assets. */
  priority?: boolean;
}

const CreativeCard = memo(function CreativeCard({ creative, className = 'look-card', onOpenProduct, canDelete, onDelete, priority = false }: CreativeCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loaded, setLoaded] = useState(false);
  const inViewport = useInViewport(cardRef);
  const impressionTracked = useRef(false);
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  // Declarative <video> element. Previously we used TrailVideoHost which
  // imperatively appendChild'd a shared video element into the slot  - 
  // good for surviving the click-into-detail handoff, bad for autoplay
  // because attributes set on a JS-created element after src can leave
  // it flagged in a "pending unmuted decode" state and reject autoplay.
  // Letting React render <video muted autoPlay playsInline> means every
  // attribute is on the element from creation, which is what every
  // browser's autoplay heuristic actually inspects. Result: muted
  // autoplay works on first paint without any user gesture.
  //
  // Belt-and-suspenders effects below force play() once metadata loads
  // and on every visibility change, so a paused element gets a kick
  // even if the autoplay policy initially blocked.

  // Static poster URL: creative thumbnail (server-extracted first frame)
  // → product image fallback. Set as <video poster=> so the browser
  // paints it during MP4 load, and as a separate <img> behind the video
  // so even a broken video URL still shows a real picture.
  const posterUrl = pickPosterUrl(creative);

  // Global Video → Still dial (/admin/dials → video_still_ratio):
  // decides whether this specific card is allowed to play video.
  // When false we render a still-only path with the retail product
  // image rather than the video's auto-extracted thumbnail — the
  // product photo is the merchandising shot and reads better. The
  // dial is a preference, not a guarantee: if we have no product
  // image to show, we still fall back to playing the video so the
  // card isn't blank.
  const globalVideoRatio = useVideoStillRatio();
  const dialPrefersVideo = shouldBeVideo(creative.id, globalVideoRatio);
  const stillImageUrl = pickStillImageUrl(creative);
  const renderAsStill = !dialPrefersVideo && !!stillImageUrl;
  // Mobile viewports get the small variant when it exists; everywhere
  // else gets full-res. Phase 8 below silently warms the full-res
  // version into cache once the card has dwelled in viewport, so a
  // tap-into-detail navigation hits the cache rather than re-downloads.
  const playableUrl = pickVideoUrl(creative);

  // Fire the impression ping once, the first time the card crosses into the
  // shared observer's pre-mount band. Visibility itself is tracked by
  // useInViewport - we just need a one-shot side effect here.
  useEffect(() => {
    if (inViewport && !impressionTracked.current) {
      impressionTracked.current = true;
      trackAdImpression(creative.id);
    }
  }, [inViewport, creative.id]);

  // Mark "loaded" once the video has frames. Also force play() at the
  // metadata + first-frame milestones - that's the moment Chrome's
  // muted-autoplay heuristic actually evaluates.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onLoaded = () => {
      setLoaded(true);
      markFeedMilestone(`first-frame:${creative.id}`);
      if (v.paused) void v.play().catch(() => {});
    };
    if (v.readyState >= 2) onLoaded();
    v.addEventListener('loadeddata', onLoaded);
    v.addEventListener('canplay',     onLoaded);
    v.addEventListener('playing',     () => setLoaded(true));
    // Hard cap: if the video never reports ready (network error,
    // unsupported codec, etc.) hide the shimmer after 4 s so the card
    // still looks correct even with a broken source.
    const timeoutId = setTimeout(() => setLoaded(true), 4000);
    return () => {
      clearTimeout(timeoutId);
      v.removeEventListener('loadeddata', onLoaded);
      v.removeEventListener('canplay', onLoaded);
    };
  }, [creative.id, playableUrl]);

  // Phase 8: once the card has been visible for ~600ms on mobile, kick
  // off a background fetch of the FULL-res variant. By the time the
  // user taps the card the bytes are cached, so the ProductPage hero
  // gets a near-instant first frame even though it uses a different
  // (higher-quality) source URL than the card itself. Desktop already
  // serves the full-res clip in the card so no extra warming needed.
  useEffect(() => {
    if (!inViewport) return;
    if (!isMobileViewport()) return;
    if (!creative.video_url) return;
    if (creative.video_url === playableUrl) return; // already fetching it
    const t = window.setTimeout(() => {
      prefetchVideoBytes(creative.video_url);
    }, 600);
    return () => window.clearTimeout(t);
  }, [inViewport, creative.id, creative.video_url, playableUrl]);

  // Resume play() on visibility return (mobile Safari pauses on tab
  // background) and on a 1 s heartbeat for the first ~10 s after mount,
  // for any element that the autoplay policy initially refused.
  useEffect(() => {
    // The <video> now only mounts while the card is in viewport (decode is
    // bounded to visible tiles — a product page no longer spins up 20-30 eager
    // decoders), so the autoplay-recovery heartbeat only needs to run then, and
    // re-arms each time the card scrolls back into view.
    if (!inViewport) return;
    const v = videoRef.current;
    if (!v) return;
    let cancelled = false;
    const kick = () => {
      if (cancelled) return;
      if (v.paused) void v.play().catch(() => {});
    };
    const onVis = () => { if (!document.hidden) kick(); };
    document.addEventListener('visibilitychange', onVis);
    const interval = window.setInterval(kick, 1000);
    const stopAt = window.setTimeout(() => window.clearInterval(interval), 10_000);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      window.clearInterval(interval);
      window.clearTimeout(stopAt);
    };
  }, [inViewport]);

  const handleClick = useCallback(() => {
    trackAdClick(creative.id);
    // Phase 9: capture the playing frame so the ProductPage hero can
    // use it as the immediate poster, eliminating the black flash
    // between feed → detail. Stashed on history.state via the parent
    // navigation handler (onOpenProduct sees the carry below).
    const frame = captureVideoFrame(videoRef.current);
    if (frame) {
      try {
        // Stash on the global so ProductPage / LookOverlay can read it
        // synchronously on mount. Cleared once consumed. Plain object
        // keyed by creative id so multiple in-flight taps don't clash.
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

  // Hover/touch-start = "user is signaling intent" → kick off the similarity
  // query for this creative now, so by the time they actually tap it (or
  // hover for >100ms), the rail is already loading. Idempotent - multiple
  // hovers coalesce onto one cached promise.
  const handlePrefetch = useCallback(() => {
    if (creative.product?.id) prefetchSimilarProducts(creative.product.id, 18);
  }, [creative.product?.id]);

  // Long-press handler - super-admin-only. On touch devices a 500ms hold
  // pops a small confirm-delete menu. Mouse equivalent is right-click
  // (handled separately via onContextMenu). Either path requires the user
  // to confirm before destruction lands.
  const beginLongPress = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (!isSuperAdmin) return;
    longPressFired.current = false;
    // Only react to single-touch on touch events.
    const isTouch = 'touches' in e;
    if (isTouch && e.touches.length !== 1) return;
    const x = isTouch ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const y = isTouch ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      setMenu({ x, y });
      // Haptic if the device supports it.
      try { (navigator as Navigator & { vibrate?: (n: number) => void }).vibrate?.(10); } catch {}
    }, 500);
  }, [isSuperAdmin]);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  // Close the admin menu on outside-click / Escape.
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
      ref={cardRef}
      className={`${className} promo-card ${loaded ? 'loaded' : ''}`}
      onClick={(e) => {
        // Suppress the click that follows a long-press release so we don't
        // open the product page right after surfacing the delete menu.
        if (longPressFired.current) {
          longPressFired.current = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        handleClick();
      }}
      onMouseEnter={handlePrefetch}
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
        {/* Static poster: thumbnail_url is the creative's own poster
            (when set); product image is the universal fallback. Sits
            behind the video slot so the card is never an empty black
            box even before frames decode. */}
        {/* Behind-the-video poster image. In still mode (Dial pushed
            this card off video) we swap to the retail product image
            since that's what reads as a merchandising shot. In video
            mode we keep the video's own thumbnail (server-extracted
            frame) so the static frame matches the playing content. */}
        {(renderAsStill ? stillImageUrl : posterUrl) && (
          <img
            className="card-poster"
            src={renderAsStill ? stillImageUrl : posterUrl}
            alt=""
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            // fetchpriority isn't in React's stock HTMLImageElement type
            // yet, so spread it via a literal attr.
            {...(priority ? { fetchpriority: 'high' as const } : {})}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 1 } as React.CSSProperties}
          />
        )}
        {/* Declarative <video> - every autoplay-relevant attribute is
            present on the element from creation, which is what every
            browser's autoplay heuristic actually inspects. JS-property
            equivalents (.muted, .autoplay) sometimes don't satisfy the
            heuristic if set after src or after a play() call.
            Skipped entirely when the Dial dropped this card into the
            still-image path. */}
        {playableUrl && !renderAsStill && inViewport && (
          <video
            ref={videoRef}
            className="card-video-slot"
            data-trail-id={creative.id}
            src={playableUrl}
            poster={posterUrl || undefined}
            muted
            autoPlay
            loop
            playsInline
            preload="auto"
            crossOrigin="anonymous"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 2, display: 'block' } as React.CSSProperties}
          />
        )}
        <div className="card-gradient" />

        {canDelete && onDelete && (
          <button
            type="button"
            className="creative-delete-btn"
            aria-label="Delete product"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete product "${creative.product?.name || "this product"}" everywhere?`)) {
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
              if (onDelete && confirm(`Delete product "${creative.product?.name || "this product"}" everywhere?`)) {
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

export default CreativeCard;
