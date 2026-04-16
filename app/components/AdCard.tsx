import { useRef, useEffect, useState, useCallback, memo } from 'react';
import { trackAdImpression, trackAdClick, type ProductAd } from '~/services/product-ads';

interface AdCardProps {
  ad: ProductAd;
  className?: string;
  onOpenProduct?: (ad: ProductAd) => void;
}

const AdCard = memo(function AdCard({ ad, className = 'look-card', onOpenProduct }: AdCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [videoSrc, setVideoSrc] = useState<string | undefined>(undefined);
  const impressionTracked = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    const card = cardRef.current;
    if (!video || !card) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          if (!videoSrc && ad.video_url) {
            setVideoSrc(ad.video_url);
          }
          video.play().catch(() => {});
          // Track impression once
          if (!impressionTracked.current) {
            impressionTracked.current = true;
            trackAdImpression(ad.id);
          }
        } else {
          video.pause();
        }
      });
    }, { rootMargin: '200px' });

    observer.observe(video);
    return () => observer.disconnect();
  }, [ad.video_url, ad.id, videoSrc]);

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
    trackAdClick(ad.id);
    if (onOpenProduct) {
      onOpenProduct(ad);
    } else if (ad.affiliate_url) {
      window.open(ad.affiliate_url, '_blank', 'noopener');
    } else if (ad.product?.url) {
      window.open(ad.product.url, '_blank', 'noopener');
    }
  }, [ad, onOpenProduct]);

  return (
    <div
      ref={cardRef}
      className={`${className} ad-card ${loaded ? 'loaded' : ''}`}
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

        {/* Bottom overlay: AD chip + product info */}
        <div className="ad-product-info">
          <div className="ad-chip">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 7v10M6 5v14M11 4l9 4v12l-9-4z"/>
            </svg>
            Ad
          </div>
          <div className="ad-product-text">
            <span className="ad-product-name">
              {ad.product?.name || 'Shop Now'}
            </span>
            {ad.product?.brand && (
              <span className="ad-product-brand">{ad.product.brand}</span>
            )}
          </div>
          {ad.product?.price && (
            <span className="ad-product-price">{ad.product.price}</span>
          )}
        </div>
      </div>
    </div>
  );
});

export default AdCard;
