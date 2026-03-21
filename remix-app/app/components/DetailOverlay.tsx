import { useEffect, useRef } from "react";
import type { Look } from "~/data/looks";
import { creators } from "~/data/looks";

interface DetailOverlayProps {
  look: Look;
  onClose: () => void;
}

export function DetailOverlay({ look, onClose }: DetailOverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const creator = creators[look.creator];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  useEffect(() => {
    videoRef.current?.play().catch(() => {});
  }, []);

  return (
    <div className="detail-backdrop" onClick={onClose}>
      <div className="detail-panel" onClick={(e) => e.stopPropagation()}>
        <div className="detail-video-section">
          <video
            ref={videoRef}
            src={`/${look.video}`}
            muted
            loop
            playsInline
            autoPlay
          />
        </div>
        <div className="detail-info-section">
          <div className="detail-header">
            <div>
              <div className="detail-title">{look.title}</div>
              <div className="detail-description">{look.description}</div>
            </div>
            <button className="detail-close" onClick={onClose}>
              &times;
            </button>
          </div>

          {creator && (
            <div className="detail-creator">
              <img
                className="detail-creator-avatar"
                src={creator.avatar}
                alt={creator.displayName}
              />
              <div>
                <div className="detail-creator-name">{creator.displayName}</div>
                <div className="detail-creator-handle">{creator.name}</div>
              </div>
            </div>
          )}

          <div className="products-title">Products in this look</div>
          <div className="product-list">
            {look.products.map((product, i) => (
              <a
                key={i}
                href={product.url}
                target="_blank"
                rel="noopener noreferrer"
                className="product-item"
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <div>
                  <div className="product-name">{product.name}</div>
                  <div className="product-brand">{product.brand}</div>
                </div>
                <div className="product-price">{product.price}</div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
