
import { useRef, useState, useCallback } from 'react';
import { Look, creators, Product } from '~/data/looks';
import { useEscapeKey } from '~/hooks/useEscapeKey';

interface BookmarksInterface {
  isLookBookmarked: (id: number) => boolean;
  toggleLookBookmark: (id: number) => void;
  isProductBookmarked: (p: Product) => boolean;
  toggleProductBookmark: (p: Product) => void;
}

interface LookOverlayProps {
  look: Look;
  onClose: () => void;
  onOpenCreator: (name: string) => void;
  onOpenBrowser: (url: string, title: string) => void;
  onOpenProduct?: (product: Product) => void;
  onCreateCatalog?: (query: string) => void;
  bookmarks: BookmarksInterface;
}

export default function LookOverlay({ look, onClose, onOpenCreator, onOpenBrowser, onOpenProduct, onCreateCatalog, bookmarks }: LookOverlayProps) {
  const detailRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [touchStartY, setTouchStartY] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const [opacity, setOpacity] = useState(1);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const [lookBookmarked, setLookBookmarked] = useState(bookmarks.isLookBookmarked(look.id));
  const [productBookmarks, setProductBookmarks] = useState<boolean[]>(
    look.products.map(p => bookmarks.isProductBookmarked(p))
  );

  const creatorData = creators[look.creator];
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

  useEscapeKey(onClose);

  // Swipe-down on the header drag area to dismiss
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    setTouchStartY(e.touches[0].clientY);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const dy = e.touches[0].clientY - touchStartY;
    if (dy > 0) {
      setTranslateY(dy);
      setOpacity(Math.max(0.3, 1 - dy / 400));
    }
  }, [touchStartY]);

  const handleTouchEnd = useCallback(() => {
    if (translateY > 120) {
      setIsAnimatingOut(true);
      setTimeout(onClose, 300);
    } else {
      setTranslateY(0);
      setOpacity(1);
    }
  }, [translateY, onClose]);

  const handleToggleLookBookmark = () => {
    bookmarks.toggleLookBookmark(look.id);
    setLookBookmarked(!lookBookmarked);
  };

  const handleToggleProductBookmark = (index: number) => {
    bookmarks.toggleProductBookmark(look.products[index]);
    setProductBookmarks(prev => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  };

  const handleProductClick = (p: Product) => {
    if (onOpenProduct) {
      onOpenProduct(p);
    } else if (p.url) {
      onOpenBrowser(p.url, p.name);
    }
  };

  const panelStyle: React.CSSProperties = isAnimatingOut
    ? { transform: 'translateY(100vh)', opacity: 0, transition: 'transform 0.3s ease, opacity 0.3s ease' }
    : translateY > 0
      ? { transform: `translateY(${translateY}px)`, opacity, transition: 'none' }
      : {};

  return (
    <div className="look-overlay">
      <div ref={detailRef} className="look-detail" style={panelStyle}>

        {/* Drag handle + back button */}
        <div
          className="look-detail-header"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <button
            className="look-back-btn-inline"
            onClick={onClose}
            aria-label="Back"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
          <div className="look-drag-handle" />
        </div>

        {/* Video — full width with padding and rounded corners */}
        <div className="look-media-wrapper">
          <div className="look-media">
            <video
              ref={videoRef}
              src={`${basePath}/${look.video}`}
              autoPlay
              loop
              muted
              playsInline
              className="look-media-video"
            />
            {/* Bottom-left: product count badge */}
            <div className="hotspot-indicator">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
                <line x1="3" y1="6" x2="21" y2="6"/>
                <path d="M16 10a4 4 0 01-8 0"/>
              </svg>
              <span>{look.products.length}</span>
            </div>
            {/* Bottom-right: catalog button */}
            <button
              className="look-create-catalog-btn"
              onClick={(e) => { e.stopPropagation(); onCreateCatalog?.(look.creator); }}
              aria-label="Create catalog"
              title="Create catalog around this look"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <line x1="3" y1="9" x2="21" y2="9"/>
                <line x1="9" y1="21" x2="9" y2="9"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Creator row */}
        <div className="look-creator-section">
          <div
            className="detail-creator-row"
            onClick={() => { onClose(); onOpenCreator(look.creator); }}
          >
            <img
              className="detail-creator-avatar"
              src={creatorData?.avatar || ''}
              alt={look.creator}
            />
            <span className="detail-creator-name">
              {creatorData?.displayName || look.creator}
            </span>
          </div>
          <button
            className={`look-bookmark-btn${lookBookmarked ? ' active' : ''}`}
            onClick={handleToggleLookBookmark}
            aria-label="Bookmark look"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill={lookBookmarked ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
        </div>

        {/* Product cards */}
        <div className="look-products-list">
          {look.products.map((p, pi) => (
            <div
              key={pi}
              className="product-card"
              onClick={() => handleProductClick(p)}
            >
              <div className="product-card-thumb">
                {p.image ? (
                  <img src={p.image} alt={p.name} className="product-thumb-img" />
                ) : (
                  <div className="product-thumb-placeholder" style={{ background: look.color, opacity: 0.5 }} />
                )}
              </div>
              <div className="product-card-info">
                {p.brand && <span className="product-brand">{p.brand}</span>}
                <span className="product-card-name">{p.name}</span>
                <span className="product-card-price">{p.price}</span>
              </div>
              <button
                className={`product-bookmark-btn${productBookmarks[pi] ? ' active' : ''}`}
                onClick={(e) => { e.stopPropagation(); handleToggleProductBookmark(pi); }}
                aria-label="Bookmark product"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill={productBookmarks[pi] ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                </svg>
              </button>
              <svg
                className="product-arrow"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
