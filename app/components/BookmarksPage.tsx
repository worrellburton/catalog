
import { useEffect, useCallback } from 'react';
import { looks, creators, Look, Product } from '~/data/looks';
import LookCard from './LookCard';

interface BookmarksInterface {
  bookmarkedLooks: number[];
  bookmarkedProducts: Product[];
  isLookBookmarked: (lookId: number) => boolean;
  toggleLookBookmark: (lookId: number) => void;
  isProductBookmarked: (p: Product) => boolean;
  toggleProductBookmark: (p: Product) => void;
}

interface BookmarksPageProps {
  bookmarks: BookmarksInterface;
  onClose: () => void;
  onOpenLook: (look: Look) => void;
  onOpenBrowser: (url: string, title: string) => void;
}

export default function BookmarksPage({ bookmarks, onClose, onOpenLook, onOpenBrowser }: BookmarksPageProps) {
  const savedLooks = looks.filter(l => bookmarks.bookmarkedLooks.includes(l.id));

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleOpenLook = useCallback((look: Look) => {
    onOpenLook(look);
  }, [onOpenLook]);

  const handleOpenCreator = useCallback(() => {}, []);

  return (
    <div className="bookmarks-page">
      <div className="bookmarks-header">
        <button className="bookmarks-back" onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Back
        </button>
        <h1 className="bookmarks-title">Saved</h1>
      </div>

      {savedLooks.length === 0 && bookmarks.bookmarkedProducts.length === 0 ? (
        <div className="bookmarks-empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          <p>No saved items yet</p>
        </div>
      ) : (
        <div className="bookmarks-grid-view">
          <div className="grid-container">
            {savedLooks.map((look) => (
              <div key={look.id} className="bookmarks-card-wrap">
                <LookCard
                  look={look}
                  className="look-card loaded"
                  onOpenLook={handleOpenLook}
                  onOpenCreator={handleOpenCreator}
                />
                <button
                  className="bookmarks-card-badge"
                  onClick={(e) => {
                    e.stopPropagation();
                    bookmarks.toggleLookBookmark(look.id);
                  }}
                  aria-label="Remove bookmark"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                </button>
              </div>
            ))}
          </div>

          {bookmarks.bookmarkedProducts.length > 0 && (
            <div className="bookmarks-products-section">
              <h2 className="bookmarks-section-title">Saved Products</h2>
              <div className="bookmarks-product-list">
                {bookmarks.bookmarkedProducts.map((p, i) => (
                  <div key={i} className="bookmarks-product-item">
                    <div className="bp-thumb" style={{ background: 'rgba(128,128,128,0.2)' }} />
                    <div
                      className="bp-info"
                      onClick={() => {
                        if (p.url) {
                          onOpenBrowser(p.url, p.name);
                        }
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <span className="bp-brand">{p.brand || ''}</span>
                      <span className="bp-name">{p.name}</span>
                      <span className="bp-price">{p.price}</span>
                    </div>
                    <button
                      className="bp-remove"
                      onClick={() => bookmarks.toggleProductBookmark(p)}
                      aria-label="Remove bookmark"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
