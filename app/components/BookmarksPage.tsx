
import { useEffect } from 'react';
import { looks, creators, Look, Product } from '~/data/looks';

interface BookmarksInterface {
  bookmarkedLooks: number[];
  bookmarkedProducts: Product[];
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
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="bookmarks-page">
      <button className="bookmarks-back" onClick={onClose}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back
      </button>

      <div className="bookmarks-content">
        <div className="bookmarks-section">
          <h2 className="bookmarks-section-title">Saved Looks</h2>
          {savedLooks.length === 0 ? (
            <p className="bookmarks-empty visible">No saved looks yet</p>
          ) : (
            <div className="bookmarks-looks-grid">
              {savedLooks.map(look => (
                <div
                  key={look.id}
                  className="bookmarks-look-card"
                  onClick={() => { onClose(); onOpenLook(look); }}
                >
                  <video src={`${basePath}/${look.video}`} muted loop playsInline autoPlay />
                  <div className="blc-info">
                    <img
                      src={creators[look.creator]?.avatar || ''}
                      style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover' }}
                      alt={look.creator}
                    />
                    <span>{look.title}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bookmarks-section">
          <h2 className="bookmarks-section-title">Saved Products</h2>
          {bookmarks.bookmarkedProducts.length === 0 ? (
            <p className="bookmarks-empty visible">No saved products yet</p>
          ) : (
            <div className="bookmarks-products-list">
              {bookmarks.bookmarkedProducts.map((p, i) => (
                <div key={i} className="bookmarks-product-item">
                  <div className="bp-thumb" style={{ background: 'rgba(128,128,128,0.2)' }} />
                  <div
                    className="bp-info"
                    onClick={() => {
                      if (p.url) {
                        onClose();
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
          )}
        </div>
      </div>
    </div>
  );
}
