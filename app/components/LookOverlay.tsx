
import { useRef, useState, useCallback, useEffect } from 'react';
import { Look, creators, Product } from '~/data/looks';
import { useEscapeKey } from '~/hooks/useEscapeKey';

type TabId = 'products' | 'creator';

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
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('products');
  const [touchStartY, setTouchStartY] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const [lookBookmarked, setLookBookmarked] = useState(bookmarks.isLookBookmarked(look.id));
  const [productBookmarks, setProductBookmarks] = useState<boolean[]>(
    look.products.map(p => bookmarks.isProductBookmarked(p))
  );

  const creatorData = creators[look.creator];
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

  // Trigger enter animation after first paint
  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  useEscapeKey(() => handleClose());

  const handleClose = useCallback(() => {
    setIsAnimatingOut(true);
    setTimeout(onClose, 320);
  }, [onClose]);

  // Swipe-down to dismiss (mobile handle area)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    setTouchStartY(e.touches[0].clientY);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const dy = e.touches[0].clientY - touchStartY;
    if (dy > 0) setTranslateY(dy);
  }, [touchStartY]);

  const handleTouchEnd = useCallback(() => {
    if (translateY > 100) {
      handleClose();
    } else {
      setTranslateY(0);
    }
  }, [translateY, handleClose]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === overlayRef.current) handleClose();
  }, [handleClose]);

  const handleToggleLookBookmark = () => {
    bookmarks.toggleLookBookmark(look.id);
    setLookBookmarked(b => !b);
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
    if (onOpenProduct) onOpenProduct(p);
    else if (p.url) onOpenBrowser(p.url, p.name);
  };

  const panelStyle: React.CSSProperties = translateY > 0
    ? { transform: `translateY(${translateY}px)`, transition: 'none' }
    : {};

  return (
    <div
      ref={overlayRef}
      className={`look-overlay${mounted && !isAnimatingOut ? ' look-overlay--in' : ''}${isAnimatingOut ? ' look-overlay--out' : ''}`}
      onClick={handleBackdropClick}
    >
      <div className="look-detail" style={panelStyle}>

        {/* ── LEFT: Video column ── */}
        <div className="look-media-col">
          {/* Mobile-only: drag handle strip */}
          <div
            className="look-drag-strip"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <span className="look-drag-pill" />
          </div>

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
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <line x1="3" y1="9" x2="21" y2="9"/>
                <line x1="9" y1="21" x2="9" y2="9"/>
              </svg>
            </button>
          </div>
        </div>

        {/* ── RIGHT: Info panel ── */}
        <div className="look-info-col">
          {/* Top bar: back + bookmark */}
          <div className="look-info-topbar">
            <button className="look-back-btn-inline" onClick={handleClose} aria-label="Back">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"/>
                <polyline points="12 19 5 12 12 5"/>
              </svg>
            </button>
            <button
              className={`look-bookmark-btn${lookBookmarked ? ' active' : ''}`}
              onClick={handleToggleLookBookmark}
              aria-label="Bookmark look"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill={lookBookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
              </svg>
            </button>
          </div>

          {/* Creator row */}
          <div
            className="look-creator-row"
            onClick={() => { handleClose(); onOpenCreator(look.creator); }}
          >
            <img className="detail-creator-avatar" src={creatorData?.avatar || ''} alt={look.creator} />
            <div className="look-creator-text">
              <span className="detail-creator-name">{creatorData?.displayName || look.creator}</span>
              <span className="look-creator-handle">@{look.creator}</span>
            </div>
          </div>

          {/* Tabs */}
          <div className="look-tabs">
            <button
              className={`look-tab${activeTab === 'products' ? ' active' : ''}`}
              onClick={() => setActiveTab('products')}
            >
              Products
              <span className="look-tab-count">{look.products.length}</span>
            </button>
            <button
              className={`look-tab${activeTab === 'creator' ? ' active' : ''}`}
              onClick={() => setActiveTab('creator')}
            >
              About
            </button>
          </div>

          {/* Tab content */}
          <div className="look-tab-content">
            {activeTab === 'products' && (
              <div className="look-products-list">
                {look.products.map((p, pi) => (
                  <div key={pi} className="product-card" onClick={() => handleProductClick(p)}>
                    <div className="product-card-thumb">
                      {p.image
                        ? <img src={p.image} alt={p.name} className="product-thumb-img" />
                        : <div className="product-thumb-placeholder" style={{ background: look.color, opacity: 0.5 }} />
                      }
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
                      <svg width="15" height="15" viewBox="0 0 24 24" fill={productBookmarks[pi] ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                      </svg>
                    </button>
                    <svg className="product-arrow" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'creator' && (
              <div className="look-creator-about">
                <div className="look-creator-about-header">
                  <img className="look-creator-about-avatar" src={creatorData?.avatar || ''} alt={look.creator} />
                  <div>
                    <div className="look-creator-about-name">{creatorData?.displayName || look.creator}</div>
                    <div className="look-creator-about-handle">@{look.creator}</div>
                  </div>
                </div>
                {creatorData?.bio && (
                  <p className="look-creator-about-bio">{creatorData.bio}</p>
                )}
                <button
                  className="look-creator-about-btn"
                  onClick={() => { handleClose(); onOpenCreator(look.creator); }}
                >
                  View all looks
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
