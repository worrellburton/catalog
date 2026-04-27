import { useRef, useEffect, useState, useCallback, memo } from 'react';
import { trackAdImpression, trackAdClick, prefetchSimilarCreatives, type ProductAd } from '~/services/product-creative';
import { useAuth } from '~/hooks/useAuth';
import { useTrailVideo } from './TrailVideoHost';

interface CreativeCardProps {
  creative: ProductAd;
  className?: string;
  onOpenProduct?: (creative: ProductAd) => void;
  canDelete?: boolean;
  onDelete?: (id: string) => void;
}

const CreativeCard = memo(function CreativeCard({ creative, className = 'look-card', onOpenProduct, canDelete, onDelete }: CreativeCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [inViewport, setInViewport] = useState(false);
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

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        setInViewport(entry.isIntersecting);
        if (entry.isIntersecting && !impressionTracked.current) {
          impressionTracked.current = true;
          trackAdImpression(creative.id);
        }
      });
    // 800px rootMargin = mount video ~5 card-heights before the card
    // enters the viewport. By the time the user actually scrolls there,
    // the <video> element has already loaded its metadata + first frame
    // (the bytes are usually in cache from primeTrailAssets too).
    }, { rootMargin: '800px' });

    observer.observe(card);
    return () => observer.disconnect();
  }, [creative.id]);

  // Mark "loaded" when the shared <video> element actually has frames. We
  // reach into the slot for it because we don't own the element — the host
  // does. This is for the shimmer overlay only.
  useEffect(() => {
    if (!inViewport) return;
    const node = slotRef.current?.querySelector('video') as HTMLVideoElement | null;
    if (!node) return;
    if (node.readyState >= 2) {
      setLoaded(true);
      return;
    }
    const handler = () => setLoaded(true);
    ['playing', 'canplay', 'loadeddata'].forEach(evt => {
      node.addEventListener(evt, handler, { once: true });
    });
    const timeout = setTimeout(() => setLoaded(true), 8000);
    return () => {
      clearTimeout(timeout);
      ['playing', 'canplay', 'loadeddata'].forEach(evt => {
        node.removeEventListener(evt, handler);
      });
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
        {/* TrailVideoHost slot — the host appendChild's the shared <video>
            element here, then moves it to the ProductPage hero on tap. The
            DOM node survives the move so playback continues unbroken; the
            overlay's opacity fade IS the entire transition. */}
        <div
          ref={setSlot}
          className="card-video-slot"
          data-trail-id={creative.id}
          style={{ position: 'absolute', inset: 0 } as React.CSSProperties}
        />
        <div className="card-gradient" />

        {canDelete && onDelete && (
          <button
            type="button"
            className="creative-delete-btn"
            aria-label="Delete creative"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete creative for ${creative.product?.name || 'this product'}?`)) {
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
              if (onDelete && confirm(`Delete creative for ${creative.product?.name || 'this product'}?`)) {
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
            Delete creative
          </button>
        </div>
      )}
    </div>
  );
});

export default CreativeCard;
