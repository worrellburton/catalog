
import { useRef, useState, useCallback, useMemo } from 'react';
import { Look, creators, Product } from '~/data/looks';
import { useEscapeKey } from '~/hooks/useEscapeKey';

// Preset hotspot positions for products on the video
// Each position is [top%, left%] — placed to simulate detected items
const HOTSPOT_POSITIONS: [number, number][] = [
  [28, 65],  // product 0: top-right area (shirt/top)
  [55, 30],  // product 1: mid-left (pants/bottom)
  [72, 55],  // product 2: lower-mid (shoes)
  [18, 40],  // product 3: top area (accessory/hat)
];

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
  const overlayRef = useRef<HTMLDivElement>(null);
  const [touchStartY, setTouchStartY] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const [opacity, setOpacity] = useState(1);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const [lookBookmarked, setLookBookmarked] = useState(bookmarks.isLookBookmarked(look.id));
  const [activeHotspot, setActiveHotspot] = useState<number | null>(null);
  const [showHotspots, setShowHotspots] = useState(true);
  const [productBookmarks, setProductBookmarks] = useState<boolean[]>(
    look.products.map(p => bookmarks.isProductBookmarked(p))
  );

  const creatorData = creators[look.creator];
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

  useEscapeKey(onClose);

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

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      onClose();
    }
  }, [onClose]);

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

  const overlayStyle: React.CSSProperties = isAnimatingOut
    ? { transform: 'translateY(100vh)', opacity: 0, transition: 'transform 0.3s ease, opacity 0.3s ease' }
    : translateY > 0
      ? { transform: `translateY(${translateY}px)`, opacity, transition: 'none' }
      : {};

  return (
    <div
      ref={overlayRef}
      className="look-overlay"
      onClick={handleOverlayClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={overlayStyle}
    >
      <div className="look-detail">
        <div className="look-media" onClick={() => setShowHotspots(h => !h)}>
          <video
            src={`${basePath}/${look.video}`}
            autoPlay
            loop
            muted
            playsInline
            style={{ width: '100%', borderRadius: 12, aspectRatio: '3/4', objectFit: 'cover' }}
          />
          {/* Product hotspot dots on video */}
          {showHotspots && look.products.map((p, i) => {
            const pos = HOTSPOT_POSITIONS[i % HOTSPOT_POSITIONS.length];
            return (
              <div
                key={i}
                className={`hotspot ${activeHotspot === i ? 'active' : ''}`}
                style={{ top: `${pos[0]}%`, left: `${pos[1]}%` }}
                onMouseEnter={() => setActiveHotspot(i)}
                onMouseLeave={() => setActiveHotspot(null)}
                onClick={(e) => { e.stopPropagation(); handleProductClick(p); }}
              >
                <span className="hotspot-dot" />
                <span className="hotspot-ping" />
                <div className={`hotspot-tooltip ${pos[1] > 50 ? 'left' : 'right'}`}>
                  <span className="hotspot-tooltip-brand">{p.brand}</span>
                  <span className="hotspot-tooltip-name">{p.name}</span>
                  <span className="hotspot-tooltip-price">{p.price}</span>
                </div>
              </div>
            );
          })}
          {/* Shopping bag icon indicator */}
          <div className="hotspot-indicator">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/>
            </svg>
            <span>{look.products.length}</span>
          </div>
        </div>

        <div className="look-info">
          <div className="detail-creator">
            <div
              className="detail-creator-row"
              onClick={() => { onClose(); onOpenCreator(look.creator); }}
              style={{ cursor: 'pointer' }}
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
              className={`look-bookmark-btn ${lookBookmarked ? 'active' : ''}`}
              onClick={handleToggleLookBookmark}
              aria-label="Bookmark look"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </button>
          </div>

          <h2 className="detail-title">{look.title}</h2>
          <p className="detail-description">{look.description}</p>

          <div className="detail-products">
            {look.products.map((p, pi) => (
              <div
                key={pi}
                className="product-item"
                onClick={() => handleProductClick(p)}
                style={{ cursor: 'pointer' }}
              >
                <div className="product-thumb">
                  {p.image ? (
                    <img src={p.image} alt={p.name} className="product-thumb-img" />
                  ) : (
                    <div className="product-thumb-placeholder" style={{ background: look.color, opacity: 0.5 }} />
                  )}
                </div>
                <div className="product-details">
                  {p.brand && <span className="product-brand">{p.brand}</span>}
                  <h4>{p.name}</h4>
                  <span>{p.price}</span>
                </div>
                <button
                  className={`product-bookmark-btn ${productBookmarks[pi] ? 'active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleProductBookmark(pi);
                  }}
                  aria-label="Bookmark product"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                </button>
                <svg className="product-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            ))}
          </div>

          <button className="create-catalog-btn" onClick={() => onCreateCatalog?.(look.creator)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
            Create catalog around this look
          </button>
        </div>
      </div>
    </div>
  );
}
