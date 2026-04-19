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
    console.log('[AdCard] mounted \u2014 ad id:', ad.id, 'video_url:', ad.video_url?.substring(0, 80), 'product:', ad.product?.name);
  }, [ad.id, ad.video_url, ad.product?.name]);

  // Debug: log card dimensions after mount
  useEffect(() => {
    const card = cardRef.current;
    const video = videoRef.current;
    if (card) {
      const rect = card.getBoundingClientRect();
      const styles = window.getComputedStyle(card);
      console.log('[AdCard] dimensions \u2014 id:', ad.id,
        'rect:', { w: rect.width, h: rect.height, top: rect.top, left: rect.left },
        'display:', styles.display, 'visibility:', styles.visibility, 'opacity:', styles.opacity,
        'overflow:', styles.overflow, 'classes:', card.className);
    }
    if (video) {
      const vRect = video.getBoundingClientRect();
      const vStyles = window.getComputedStyle(video);
      console.log('[AdCard] video element \u2014 id:', ad.id,
        'rect:', { w: vRect.width, h: vRect.height },
        'display:', vStyles.display, 'visibility:', vStyles.visibility, 'opacity:', vStyles.opacity,
        'position:', vStyles.position);
    }
  }, [ad.id]);

  useEffect(() => {
    const video = videoRef.current;
    const card = cardRef.current;
    if (!video || !card) {
      console.warn('[AdCard] refs missing \u2014 video:', !!video, 'card:', !!card, 'id:', ad.id);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        console.log('[AdCard] IntersectionObserver \u2014 id:', ad.id, 'isIntersecting:', entry.isIntersecting, 'videoSrc set:', !!videoSrc);
        if (entry.isIntersecting) {
          if (!videoSrc && ad.video_url) {
            console.log('[AdCard] setting videoSrc \u2014 id:', ad.id, 'url:', ad.video_url?.substring(0, 80));
            setVideoSrc(ad.video_url);
          }
          video.play().catch((err) => {
            console.warn('[AdCard] play() failed \u2014 id:', ad.id, 'error:', err?.message);
          });
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

  // Debug: listen for video error events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onError = () => {
      const err = video.error;
      console.error('[AdCard] video error \u2014 id:', ad.id, 'code:', err?.code, 'message:', err?.message, 'src:', video.src?.substring(0, 80));
    };
    const onLoadStart = () => console.log('[AdCard] video loadstart \u2014 id:', ad.id, 'src:', video.src?.substring(0, 80));
    const onStalled = () => console.warn('[AdCard] video stalled \u2014 id:', ad.id);
    video.addEventListener('error', onError);
    video.addEventListener('loadstart', onLoadStart);
    video.addEventListener('stalled', onStalled);
    return () => {
      video.removeEventListener('error', onError);
      video.removeEventListener('loadstart', onLoadStart);
      video.removeEventListener('stalled', onStalled);
    };
  }, [ad.id]);

  const markLoaded = useCallback(() => {
    console.log('[AdCard] markLoaded called \u2014 id:', ad.id);
    setLoaded(true);
  }, [ad.id]);

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

        {/* Bottom overlay: brand + product name + price */}
        <div className="promo-product-info">
          <div className="promo-product-text">
            {ad.product?.brand && (
              <span className="promo-product-brand">{ad.product.brand}</span>
            )}
            <span className="promo-product-name">
              {ad.product?.name || 'Shop Now'}
            </span>
          </div>
          {ad.product?.price && (
            <span className="promo-product-price">{ad.product.price}</span>
          )}
        </div>
      </div>
    </div>
  );
});

export default AdCard;
