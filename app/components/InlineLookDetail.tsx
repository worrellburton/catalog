import { useRef, useState, useCallback, useEffect } from 'react';
import { Look, creators, Product } from '~/data/looks';

interface BookmarksInterface {
  isLookBookmarked: (id: number) => boolean;
  toggleLookBookmark: (id: number) => void;
  isProductBookmarked: (p: Product) => boolean;
  toggleProductBookmark: (p: Product) => void;
}

interface InlineLookDetailProps {
  look: Look;
  onOpenCreator: (name: string) => void;
  onOpenBrowser: (url: string, title: string) => void;
  onOpenProduct?: (product: Product) => void;
  onCreateCatalog?: (query: string) => void;
  bookmarks: BookmarksInterface;
}

export default function InlineLookDetail({ look, onOpenCreator, onOpenBrowser, onOpenProduct, onCreateCatalog, bookmarks }: InlineLookDetailProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [lookBookmarked, setLookBookmarked] = useState(bookmarks.isLookBookmarked(look.id));
  const [productBookmarks, setProductBookmarks] = useState(
    look.products.map(p => bookmarks.isProductBookmarked(p))
  );

  const basePath = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  const creatorData = creators[look.creator];

  // IntersectionObserver: play video when visible, pause when not
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  const handleToggleLookBookmark = useCallback(() => {
    bookmarks.toggleLookBookmark(look.id);
    setLookBookmarked(b => !b);
  }, [bookmarks, look.id]);

  const handleToggleProductBookmark = useCallback((idx: number) => {
    bookmarks.toggleProductBookmark(look.products[idx]);
    setProductBookmarks(prev => prev.map((b, i) => i === idx ? !b : b));
  }, [bookmarks, look.products]);

  const handleProductClick = useCallback((p: Product) => {
    if (onOpenProduct) {
      onOpenProduct(p);
    } else {
      onOpenBrowser(p.url, p.name);
    }
  }, [onOpenProduct, onOpenBrowser]);

  return (
    <div className="inline-look-detail popout" ref={containerRef}>
      {/* Full-viewport video popout */}
      <div className="popout-video-section">
        <video
          ref={videoRef}
          src={`${basePath}/${look.video}`}
          loop
          muted
          playsInline
        />
        {/* Gradient overlay at bottom of video */}
        <div className="popout-video-gradient" />
        {/* Creator + actions overlaid on video */}
        <div className="popout-video-top">
          <div className="hotspot-indicator">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/>
            </svg>
            <span>{look.products.length}</span>
          </div>
          <div className="popout-video-top-right">
            <button
              className={`popout-bookmark-btn ${lookBookmarked ? 'active' : ''}`}
              onClick={handleToggleLookBookmark}
              aria-label="Bookmark look"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill={lookBookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </button>
            {onCreateCatalog && (
              <button
                className="popout-catalog-btn"
                onClick={() => onCreateCatalog(look.creator)}
                aria-label="Create catalog"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
              </button>
            )}
          </div>
        </div>
        {/* Creator info overlaid at bottom of video */}
        <div className="popout-video-bottom">
          <div
            className="popout-creator"
            onClick={() => onOpenCreator(look.creator)}
          >
            <img
              className="popout-creator-avatar"
              src={creatorData?.avatar || ''}
              alt={look.creator}
            />
            <div className="popout-creator-info">
              <span className="popout-creator-name">
                {creatorData?.displayName || look.creator}
              </span>
              <span className="popout-look-title">{look.title}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Products section below video */}
      <div className="popout-products-section">
        <p className="popout-desc">{look.description}</p>
        <div className="popout-products">
          {look.products.map((p, pi) => (
            <div
              key={pi}
              className="popout-product-card"
              onClick={() => handleProductClick(p)}
            >
              <div className="popout-product-thumb">
                {p.image ? (
                  <img src={p.image} alt={p.name} />
                ) : (
                  <div className="popout-product-thumb-placeholder" style={{ background: look.color }} />
                )}
              </div>
              <div className="popout-product-info">
                {p.brand && <span className="popout-product-brand">{p.brand}</span>}
                <span className="popout-product-name">{p.name}</span>
                <span className="popout-product-price">{p.price}</span>
              </div>
              <div className="popout-product-actions">
                <button
                  className={`popout-product-bookmark ${productBookmarks[pi] ? 'active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleProductBookmark(pi);
                  }}
                  aria-label="Bookmark product"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill={productBookmarks[pi] ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                </button>
                <svg className="popout-product-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
