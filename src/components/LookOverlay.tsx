'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Look, creators, Product } from '@/data/looks';

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
  bookmarks: BookmarksInterface;
}

export default function LookOverlay({ look, onClose, onOpenCreator, onOpenBrowser, bookmarks }: LookOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [touchStartY, setTouchStartY] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const [opacity, setOpacity] = useState(1);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const [lookBookmarked, setLookBookmarked] = useState(bookmarks.isLookBookmarked(look.id));
  const [productBookmarks, setProductBookmarks] = useState<boolean[]>(
    look.products.map(p => bookmarks.isProductBookmarked(p))
  );

  const creatorData = creators[look.creator];
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '/catalogwebapp';

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

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
        <button className="close-look" onClick={onClose}>&times;</button>

        <div className="look-media">
          <video
            src={`${basePath}/${look.video}`}
            autoPlay
            loop
            muted
            playsInline
            style={{ width: '100%', borderRadius: 12, aspectRatio: '3/4', objectFit: 'cover' }}
          />
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
                onClick={() => {
                  if (p.url) onOpenBrowser(p.url, p.name);
                }}
                style={{ cursor: 'pointer' }}
              >
                <div className="product-thumb" style={{ background: look.color, opacity: 0.5 }} />
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
        </div>
      </div>
    </div>
  );
}
