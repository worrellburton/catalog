
import { useRef, useEffect, useState, useCallback, memo } from 'react';
import { Look, creators } from '~/data/looks';

interface LookCardProps {
  look: Look;
  className?: string;
  onOpenLook: (look: Look) => void;
  onOpenCreator: (creatorName: string) => void;
  onCreateCatalog?: (query: string) => void;
}

const LookCard = memo(function LookCard({ look, className = 'look-card', onOpenLook, onOpenCreator, onCreateCatalog }: LookCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [videoSrc, setVideoSrc] = useState<string | undefined>(undefined);

  const creatorData = creators[look.creator];
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

  useEffect(() => {
    const video = videoRef.current;
    const card = cardRef.current;
    if (!video || !card) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          if (!videoSrc) {
            setVideoSrc(`${basePath}/${look.video}`);
          }
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      });
    }, { rootMargin: '200px' });

    observer.observe(video);
    return () => observer.disconnect();
  }, [look.video, videoSrc, basePath]);

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

  return (
    <div
      ref={cardRef}
      className={`${className} ${loaded ? 'loaded' : ''}`}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('.card-creator-row')) {
          onOpenLook(look);
        }
      }}
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
        {onCreateCatalog && (
          <button
            className="card-catalog-btn"
            onClick={(e) => {
              e.stopPropagation();
              onCreateCatalog(look.creator);
            }}
            aria-label="Create catalog from this look"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
          </button>
        )}
        {look.title && (
          <span className="card-title">{look.title}</span>
        )}
        <div
          className="card-creator-row"
          onClick={(e) => {
            e.stopPropagation();
            onOpenCreator(look.creator);
          }}
        >
          <img
            className="card-creator-avatar"
            src={creatorData?.avatar || ''}
            alt={look.creator}
          />
          <span className="card-creator-name">
            {creatorData?.displayName || look.creator}
          </span>
        </div>
      </div>
    </div>
  );
});

export default LookCard;
