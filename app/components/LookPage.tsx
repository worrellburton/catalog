import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Look, looks as allLooks, creators, Product } from '~/data/looks';
import { getSimilarLooks } from '~/utils/similarity';
import LookCard from './LookCard';

interface BookmarksInterface {
  isLookBookmarked: (id: number) => boolean;
  toggleLookBookmark: (id: number) => void;
  isProductBookmarked: (p: Product) => boolean;
  toggleProductBookmark: (p: Product) => void;
}

interface LookPageProps {
  look: Look;
  onClose: () => void;
  onOpenLook: (look: Look) => void;
  onOpenCreator: (name: string) => void;
  onOpenBrowser: (url: string, title: string) => void;
  onOpenProduct?: (product: Product) => void;
  onCreateCatalog?: (query: string) => void;
  bookmarks: BookmarksInterface;
}

export default function LookPage({
  look,
  onClose,
  onOpenLook,
  onOpenCreator,
  onOpenBrowser,
  onOpenProduct,
  onCreateCatalog,
  bookmarks,
}: LookPageProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [lookBookmarked, setLookBookmarked] = useState(bookmarks.isLookBookmarked(look.id));
  const [productBookmarks, setProductBookmarks] = useState(
    look.products.map(p => bookmarks.isProductBookmarked(p))
  );

  const basePath = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  const creatorData = creators[look.creator];

  const relatedLooks = useMemo(() => {
    return getSimilarLooks(look, allLooks, 12, new Set([look.id]));
  }, [look]);

  // Scroll to top when look changes
  useEffect(() => {
    pageRef.current?.scrollTo(0, 0);
  }, [look.id]);

  // Auto-play video
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.play().catch(() => {});
    }
  }, [look.id]);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

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
    <div className="look-page" ref={pageRef}>
      {/* Back button */}
      <button className="look-page-back" onClick={onClose} aria-label="Back">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      {/* Video — full width, tall */}
      <div className="look-page-video-section">
        <video
          ref={videoRef}
          src={`${basePath}/${look.video}`}
          loop
          muted
          playsInline
        />
        <div className="look-page-video-gradient" />

        {/* Top overlay — product count + actions */}
        <div className="look-page-video-top">
          <div className="look-page-hotspot">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/>
            </svg>
            <span>{look.products.length}</span>
          </div>
          <div className="look-page-actions">
            <button
              className={`look-page-action-btn ${lookBookmarked ? 'active' : ''}`}
              onClick={handleToggleLookBookmark}
              aria-label="Bookmark look"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill={lookBookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </button>
            {onCreateCatalog && (
              <button
                className="look-page-action-btn"
                onClick={() => onCreateCatalog(look.creator)}
                aria-label="Create catalog"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
              </button>
            )}
          </div>
        </div>

        {/* Creator info at bottom of video */}
        <div className="look-page-video-bottom">
          <div className="look-page-creator" onClick={() => onOpenCreator(look.creator)}>
            <img
              className="look-page-creator-avatar"
              src={creatorData?.avatar || ''}
              alt={look.creator}
            />
            <div className="look-page-creator-text">
              <span className="look-page-creator-name">
                {creatorData?.displayName || look.creator}
              </span>
              <span className="look-page-look-title">{look.title}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Products */}
      <div className="look-page-products-section">
        <p className="look-page-desc">{look.description}</p>
        <div className="look-page-products">
          {look.products.map((p, pi) => (
            <div
              key={pi}
              className="look-page-product"
              onClick={() => handleProductClick(p)}
            >
              <div className="look-page-product-thumb">
                {p.image ? (
                  <img src={p.image} alt={p.name} />
                ) : (
                  <div className="look-page-product-placeholder" style={{ background: look.color }} />
                )}
              </div>
              <div className="look-page-product-info">
                {p.brand && <span className="look-page-product-brand">{p.brand}</span>}
                <span className="look-page-product-name">{p.name}</span>
                <span className="look-page-product-price">{p.price}</span>
              </div>
              <div className="look-page-product-end">
                <button
                  className={`look-page-product-bm ${productBookmarks[pi] ? 'active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleProductBookmark(pi);
                  }}
                  aria-label="Bookmark product"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill={productBookmarks[pi] ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                </button>
                <svg className="look-page-product-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Related feed */}
      {relatedLooks.length > 0 && (
        <div className="look-page-related">
          <div className="look-page-related-header">More like this</div>
          <div className="look-page-related-grid">
            {relatedLooks.map((rl) => (
              <LookCard
                key={rl.id}
                look={rl}
                onOpenLook={onOpenLook}
                onOpenCreator={onOpenCreator}
                onCreateCatalog={onCreateCatalog}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
