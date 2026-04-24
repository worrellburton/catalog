import { useRef, useEffect, useState, useCallback, memo } from 'react';
import { trackAdImpression, trackAdClick, type ProductAd } from '~/services/product-ads';
import { getBrandDomain, brandLogoUrl } from '~/utils/brandLogo';

interface CreativeCardProps {
  creative: ProductAd;
  className?: string;
  onOpenProduct?: (creative: ProductAd) => void;
  canDelete?: boolean;
  onDelete?: (id: string) => void;
}

const CreativeCard = memo(function CreativeCard({ creative, className = 'look-card', onOpenProduct, canDelete, onDelete }: CreativeCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [videoSrc, setVideoSrc] = useState<string | undefined>(undefined);
  const [logoFailed, setLogoFailed] = useState(false);
  const impressionTracked = useRef(false);
  const brandDomain = getBrandDomain(creative.product);

  useEffect(() => {
    const video = videoRef.current;
    const card = cardRef.current;
    if (!video || !card) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          if (!videoSrc && creative.video_url) {
            setVideoSrc(creative.video_url);
          }
          video.play().catch(() => {});
          if (!impressionTracked.current) {
            impressionTracked.current = true;
            trackAdImpression(creative.id);
          }
        } else {
          video.pause();
        }
      });
    }, { rootMargin: '200px' });

    observer.observe(video);
    return () => observer.disconnect();
  }, [creative.video_url, creative.id, videoSrc]);

  const markLoaded = useCallback(() => {
    setLoaded(true);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handler = () => markLoaded();
    ['playing', 'canplay', 'loadeddata'].forEach(evt => {
      video.addEventListener(evt, handler, { once: true });
    });

    const timeout = setTimeout(() => markLoaded(), 8000);
    return () => {
      clearTimeout(timeout);
      ['playing', 'canplay', 'loadeddata'].forEach(evt => {
        video.removeEventListener(evt, handler);
      });
    };
  }, [markLoaded]);

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

  return (
    <div
      ref={cardRef}
      className={`${className} promo-card ${loaded ? 'loaded' : ''}`}
      onClick={handleClick}
    >
      <div className="card-inner">
        {!loaded && <div className="card-shimmer" />}
        <video
          ref={videoRef}
          src={videoSrc}
          muted
          loop
          playsInline
          preload="none"
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
              <span className="promo-product-brand">
                {brandDomain && !logoFailed && (
                  <img
                    className="promo-brand-logo"
                    src={brandLogoUrl(brandDomain)}
                    alt=""
                    loading="lazy"
                    onError={() => setLogoFailed(true)}
                  />
                )}
                {creative.product.brand}
              </span>
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
