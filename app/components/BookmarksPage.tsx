
import { useCallback } from 'react';
import { creators, Look, Product } from '~/data/looks';
import { type ProductAd } from '~/services/product-creative';
import { useEscapeKey } from '~/hooks/useEscapeKey';
import LookCard from './LookCard';

interface BookmarksInterface {
  bookmarkedLooks: number[];
  bookmarkedProducts: Product[];
  followedCreators: string[];
  isLookBookmarked: (lookId: number) => boolean;
  toggleLookBookmark: (lookId: number) => void;
  isProductBookmarked: (p: Product) => boolean;
  toggleProductBookmark: (p: Product) => void;
  isCreatorFollowed: (handle: string) => boolean;
  toggleCreatorFollow: (handle: string) => void;
}

interface BookmarksPageProps {
  bookmarks: BookmarksInterface;
  onClose: () => void;
  onOpenLook: (look: Look) => void;
  onOpenBrowser: (url: string, title: string) => void;
  onOpenProduct?: (product: Product) => void;
  onOpenCreative?: (creative: ProductAd) => void;
  onOpenCreator?: (handle: string) => void;
  onOpenBrand?: (brandName: string) => void;
  /** Live looks fetched from Supabase — used to resolve bookmarked look IDs. */
  savedLooks?: Look[];
}

export default function BookmarksPage({ bookmarks, onClose, onOpenLook, onOpenBrowser, onOpenProduct, onOpenCreative, onOpenCreator, onOpenBrand, savedLooks = [] }: BookmarksPageProps) {
  const followedCreatorData = bookmarks.followedCreators
    .map(handle => ({ handle, data: creators[handle] }))
    .filter(c => c.data);

  useEscapeKey(onClose);

  const handleOpenLook = useCallback((look: Look) => {
    onOpenLook(look);
  }, [onOpenLook]);

  const handleOpenProductCard = useCallback((p: Product) => {
    if (p.video_url && onOpenCreative) {
      const creative: ProductAd = {
        id: p.creative_id || '',
        product_id: (p as Product & { id?: string }).id || '',
        look_id: null,
        title: p.name,
        description: null,
        video_url: p.video_url,
        mobile_video_url: null,
        storage_path: null,
        thumbnail_url: p.thumbnail_url || null,
        affiliate_url: null,
        prompt: null,
        prompt_extra: null,
        style: '',
        model: null,
        status: 'live',
        duration_seconds: null,
        aspect_ratio: null,
        resolution: null,
        cost_usd: null,
        impressions: 0,
        clicks: 0,
        error: null,
        enabled: true,
        created_at: '',
        completed_at: null,
        updated_at: null,
        product: {
          id: (p as Product & { id?: string }).id || '',
          name: p.name,
          brand: p.brand,
          price: p.price,
          image_url: p.image || null,
          images: null,
          url: p.url,
          type: null,
          catalog_tags: null,
          gender: null,
        },
      };
      onOpenCreative(creative);
    } else if (onOpenProduct) {
      onOpenProduct(p);
    } else if (p.url) {
      onOpenBrowser(p.url, p.name);
    }
  }, [onOpenCreative, onOpenProduct, onOpenBrowser]);

  const noop = useCallback(() => {}, []);

  return (
    <div className="bookmarks-page">
      <div className="bookmarks-header">
        <button className="bookmarks-back" onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Back
        </button>
        <h1 className="bookmarks-title">Saved</h1>
      </div>

      {/* Followed Creators */}
      {followedCreatorData.length > 0 && (
        <div className="bookmarks-creators-section">
          <h2 className="bookmarks-section-title">Your Circle</h2>
          <div className="bookmarks-creators-row">
            {followedCreatorData.map(({ handle, data }) => (
              <div
                key={handle}
                className="bookmarks-creator-card"
                onClick={() => onOpenCreator?.(handle)}
              >
                <img className="bookmarks-creator-avatar" src={data.avatar} alt={data.displayName} />
                <span className="bookmarks-creator-name">{data.displayName}</span>
                <span className="bookmarks-creator-handle">{handle}</span>
                <button
                  className="bookmarks-creator-unfollow"
                  onClick={(e) => { e.stopPropagation(); bookmarks.toggleCreatorFollow(handle); }}
                >
                  Following
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {savedLooks.length === 0 && bookmarks.bookmarkedProducts.length === 0 && followedCreatorData.length === 0 ? (
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
                  onOpenCreator={noop}
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
            {bookmarks.bookmarkedProducts.map((p, i) => (
              <div key={`product-${i}`} className="bookmarks-card-wrap">
                <button
                  type="button"
                  className="bookmarks-product-card"
                  onClick={() => handleOpenProductCard(p)}
                >
                  {p.video_url
                    ? <video
                        className="bpc-img"
                        src={p.video_url}
                        poster={p.thumbnail_url || p.image || ''}
                        autoPlay
                        muted
                        loop
                        playsInline
                      />
                    : p.image
                      ? <img className="bpc-img" src={p.image} alt={p.name} loading="lazy" />
                      : <div className="bpc-img-placeholder" />}
                  <div className="bpc-info">
                    {p.brand && (
                      <span
                        className="bpc-brand"
                        role={onOpenBrand ? 'button' : undefined}
                        onClick={onOpenBrand ? (e) => { e.stopPropagation(); onOpenBrand(p.brand!); } : undefined}
                      >
                        {p.brand}
                      </span>
                    )}
                    <span className="bpc-name">{p.name}</span>
                    {p.price && <span className="bpc-price">{p.price}</span>}
                  </div>
                </button>
                <button
                  className="bookmarks-card-badge"
                  onClick={(e) => { e.stopPropagation(); bookmarks.toggleProductBookmark(p); }}
                  aria-label="Remove bookmark"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
