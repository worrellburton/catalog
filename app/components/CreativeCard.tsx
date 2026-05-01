import { useRef, useEffect, useState, useCallback, memo } from 'react';
import { trackAdImpression, trackAdClick, prefetchSimilarCreatives, type ProductAd } from '~/services/product-creative';
import { useAuth } from '~/hooks/useAuth';
import { useInViewport } from '~/hooks/useInViewport';
import { useTrailVideo } from './TrailVideoHost';

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
  const slotRef = useRef<HTMLDivElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const inViewport = useInViewport(cardRef);
  const impressionTracked = useRef(false);
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  // The TrailVideoHost pool keeps the shared <video> element alive across
  // remounts, so clicking a card hands the same DOM node — and its
  // currentTime / decoded frames — to the ProductPage hero. Result: no
  // reload, no first-frame black gap, even without an explicit morph.
  const setVideoSlot = useTrailVideo(
    inViewport ? creative.id : undefined,
    inViewport ? creative.video_url ?? undefined : undefined,
  );

  const setSlot = useCallback((node: HTMLDivElement | null) => {
    slotRef.current = node;
    setVideoSlot(node);
  }, [setVideoSlot]);

  // Static poster URL — used as a fallback layer behind the video so
  // the card always shows a real image even before video frames decode
  // (and even if the video URL is broken or absent entirely).
  const posterUrl = creative.thumbnail_url
    || creative.product?.image_url
    || (creative.product?.images && creative.product.images[0])
    || '';

  // Fire the impression ping once, the first time the card crosses into the
  // shared observer's pre-mount band. Visibility itself is tracked by
  // useInViewport — we just need a one-shot side effect here.
  useEffect(() => {
    if (inViewport && !impressionTracked.current) {
      impressionTracked.current = true;
      trackAdImpression(creative.id);
    }
  }, [inViewport, creative.id]);

  // Mark "loaded" when the shared <video> element actually has frames.
  // We reach into the slot for it because TrailVideoHost owns the element.
  //
  // Race condition: useTrailVideo appends the <video> during the React
  // commit phase (ref callback), but this effect also fires on the same
  // commit. The video may not be in the DOM yet when the effect runs, so we
  // use a MutationObserver to wait for it rather than querying immediately.
  useEffect(() => {
    if (!inViewport) return;
    const slot = slotRef.current;
    if (!slot) return;

    let timeoutId: ReturnType<typeof setTimeout>;
    let mo: MutationObserver | undefined;

    const attachListeners = (node: HTMLVideoElement) => {
      if (node.readyState >= 2) { setLoaded(true); return; }
      const handler = () => setLoaded(true);
      ['playing', 'canplay', 'loadeddata'].forEach(evt =>
        node.addEventListener(evt, handler, { once: true })
      );
    };

    const existing = slot.querySelector('video') as HTMLVideoElement | null;
    if (existing) {
      attachListeners(existing);
    } else {
      mo = new MutationObserver(() => {
        const v = slot.querySelector('video') as HTMLVideoElement | null;
        if (v) { mo!.disconnect(); mo = undefined; attachListeners(v); }
      });
      mo.observe(slot, { childList: true, subtree: true });
    }

    // Hard cap: if the video never fires a ready event (network error,
    // unsupported codec, etc.) hide the shimmer after 4 s so the card
    // still looks correct even with a broken source.
    timeoutId = setTimeout(() => setLoaded(true), 4000);

    return () => {
      clearTimeout(timeoutId);
      mo?.disconnect();
    };
  }, [inViewport, creative.id]);

  const handleClick = useCallback(() => {
    trackAdClick(creative.id);
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
  // hover for >100ms), the rail is already loading. Idempotent — multiple
  // hovers coalesce onto one cached promise.
  const handlePrefetch = useCallback(() => {
    if (creative.id) prefetchSimilarCreatives(creative.id, 18);
  }, [creative.id]);

  // Long-press handler — super-admin-only. On touch devices a 500ms hold
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
        {posterUrl && (
          <img
            className="card-poster"
            src={posterUrl}
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
        {/* TrailVideoHost slot — the host appendChild's the shared <video>
            element here, then moves it to the ProductPage hero on tap. The
            DOM node survives the move so playback continues unbroken; the
            overlay's opacity fade IS the entire transition. */}
        <div
          ref={setSlot}
          className="card-video-slot"
          data-trail-id={creative.id}
          style={{ position: 'absolute', inset: 0, zIndex: 2 } as React.CSSProperties}
        />
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
