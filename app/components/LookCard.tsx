
import { useRef, useEffect, useState, useCallback, memo } from 'react';
import { Look, creators } from '~/data/looks';

interface LookCardProps {
  look: Look;
  className?: string;
  onOpenLook: (look: Look) => void;
  onOpenCreator: (creatorName: string) => void;
}

const LookCard = memo(function LookCard({ look, className = 'look-card', onOpenLook, onOpenCreator }: LookCardProps) {
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
        <div className="card-creator-row">
          <img
            className="card-creator-avatar"
            src={creatorData?.avatar || ''}
            alt={look.creator}
          />
          <span className="card-creator-name">
            {creatorData?.displayName || look.creator}
          </span>
          <button
            className="card-creator-btn"
            onClick={(e) => {
              e.stopPropagation();
              onOpenCreator(look.creator);
            }}
            aria-label={`View ${creatorData?.displayName || look.creator}`}
          >
            View
          </button>
        </div>
      </div>
    </div>
  );
});

export default LookCard;
