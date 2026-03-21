import { useRef, useEffect, memo } from "react";
import type { Look } from "~/data/looks";
import { creators } from "~/data/looks";

interface LookCardProps {
  look: Look;
  onClick: () => void;
}

function LookCardInner({ look, onClick }: LookCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    const card = cardRef.current;
    if (!video || !card) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            video.play().catch(() => {});
          } else {
            video.pause();
          }
        });
      },
      { threshold: 0.3 }
    );

    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  const creator = creators[look.creator];

  return (
    <div className="look-card" ref={cardRef} onClick={onClick}>
      <video
        ref={videoRef}
        src={`/${look.video}`}
        muted
        loop
        playsInline
        preload="metadata"
      />
      <div className="card-overlay">
        <div className="card-title">{look.title}</div>
        {creator && <div className="card-creator">{creator.displayName}</div>}
      </div>
    </div>
  );
}

export const LookCard = memo(LookCardInner);
