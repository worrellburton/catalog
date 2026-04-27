import { useRef, useEffect, useState, useCallback, memo } from 'react';
import { trackAdImpression, trackAdClick, prefetchSimilarCreatives, type ProductAd } from '~/services/product-creative';
import { useTrailVideo } from './TrailVideoHost';
import { TrailMorph } from './TrailMotion';

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

  // Defer slot population to when the card scrolls in. The TrailVideoHost
  // pool keeps elements alive across remounts, so the same id picked up by
  // the overlay hero shares the running element — no reload, no black gap.
  const setVideoSlot = useTrailVideo(
    inViewport ? creative.id : undefined,
    inViewport ? creative.video_url ?? undefined : undefined,
  );

  // Compose the slot ref + the trail-video ref-callback. The callback runs
  // each time the underlying node changes (mount, in/out of viewport).
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
    }, { rootMargin: '200px' });

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

  return (
    <div
      ref={cardRef}
      className={`${className} promo-card ${loaded ? 'loaded' : ''}`}
      onClick={handleClick}
      onMouseEnter={handlePrefetch}
      onTouchStart={handlePrefetch}
    >
      <div className="card-inner">
        {!loaded && <div className="card-shimmer" />}
        {/* TrailMorph: layoutId="trail-${id}" matches the same id on the
            ProductPage hero, so Framer Motion morphs the box position+size
            between mounts. The shared <video> element living inside is moved
            via appendChild by TrailVideoHost — neither React nor Framer touch
            it, so playback survives the morph. */}
        <TrailMorph
          id={creative.id}
          className="card-video-slot"
          style={{ position: 'absolute', inset: 0 } as React.CSSProperties}
        >
          <div ref={setSlot} className="card-video-slot-inner" style={{ width: '100%', height: '100%' }} data-trail-id={creative.id} />
        </TrailMorph>
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
    </div>
  );
});

export default CreativeCard;
