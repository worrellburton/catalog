
import { useMemo, useState, useEffect, useCallback } from 'react';
import { Product, Look, looks, creators } from '~/data/looks';
import { useEscapeKey } from '~/hooks/useEscapeKey';

interface ProductPageProps {
  product: Product;
  onClose: () => void;
  onOpenLook: (look: Look) => void;
  onOpenBrowser: (url: string, title: string) => void;
  onOpenProduct?: (product: Product) => void;
  onOpenCreator?: (name: string) => void;
  onCreateCatalog?: (query: string) => void;
}

export default function ProductPage({ product, onClose, onOpenLook, onOpenBrowser, onOpenProduct, onOpenCreator, onCreateCatalog }: ProductPageProps) {
  const [mounted, setMounted] = useState(false);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  const handleClose = useCallback(() => {
    setIsAnimatingOut(true);
    setTimeout(onClose, 320);
  }, [onClose]);

  useEscapeKey(handleClose);

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

  // Find all looks that contain this product
  const relatedLooks = useMemo(() => {
    return looks.filter(look =>
      look.products.some(p => p.name === product.name && p.brand === product.brand)
    );
  }, [product]);

  // Find unique creators who own/feature this product
  const ownerCreators = useMemo(() => {
    const seen = new Set<string>();
    return relatedLooks
      .filter(look => {
        if (seen.has(look.creator)) return false;
        seen.add(look.creator);
        return true;
      })
      .map(look => ({
        key: look.creator,
        data: creators[look.creator],
        lookCount: relatedLooks.filter(l => l.creator === look.creator).length,
      }));
  }, [relatedLooks]);

  // Find similar/other products (exclude current, dedupe)
  const similarProducts = useMemo(() => {
    const allProducts = looks.flatMap(l => l.products);
    const seen = new Set<string>();
    seen.add(`${product.brand}-${product.name}`);
    return allProducts.filter(p => {
      const key = `${p.brand}-${p.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 6);
  }, [product]);

  return (
    <div className={`product-page-overlay${mounted && !isAnimatingOut ? ' product-page-overlay--in' : ''}${isAnimatingOut ? ' product-page-overlay--out' : ''}`}>
      <div className="product-page">
        <button className="product-page-back" onClick={handleClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Back
        </button>

        <div className="product-page-content">
          {/* Product hero */}
          <div className="product-page-hero">
            <div className="product-page-image">
              {product.image ? (
                <img src={product.image.replace('w=200&h=200', 'w=600&h=600')} alt={product.name} />
              ) : (
                <div className="product-page-placeholder" />
              )}
            </div>
            <div className="product-page-info">
              <span className="product-page-brand">{product.brand}</span>
              <h1 className="product-page-name">{product.name}</h1>
              <span className="product-page-price">{product.price}</span>
              <button
                className="product-page-shop-btn"
                onClick={() => onOpenBrowser(product.url, product.name)}
                disabled={!product.url}
              >
                Shop on {product.brand}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
              </button>
              <button className="create-catalog-btn" onClick={() => onCreateCatalog?.(product.brand)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
                Create catalog around this product
              </button>
            </div>
          </div>

          {/* Owned by creators */}
          {ownerCreators.length > 0 && (
            <div className="product-page-section">
              <h3 className="product-page-section-title">Owned by</h3>
              <div className="product-page-creators">
                {ownerCreators.map(({ key, data, lookCount }) => (
                  <div
                    key={key}
                    className="product-page-creator-card"
                  onClick={() => { if (onOpenCreator) { handleClose(); onOpenCreator(key); } }}
                  >
                    <img
                      src={data?.avatar || ''}
                      alt={data?.displayName || key}
                      className="product-page-creator-avatar"
                    />
                    <div className="product-page-creator-info">
                      <span className="product-page-creator-name">{data?.displayName || key}</span>
                      <span className="product-page-creator-handle">{key}</span>
                    </div>
                    <span className="product-page-creator-looks">{lookCount} {lookCount === 1 ? 'look' : 'looks'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Creators who feature this product */}
          {relatedLooks.length > 0 && (
            <div className="product-page-section">
              <h3 className="product-page-section-title">Featured in</h3>
              <div className="product-page-looks">
                {relatedLooks.map(look => {
                  const creator = creators[look.creator];
                  return (
                    <div
                      key={look.id}
                      className="product-page-look-card"
                      onClick={() => { handleClose(); onOpenLook(look); }}
                    >
                      <video
                        src={`${basePath}/${look.video}`}
                        muted
                        playsInline
                        loop
                        autoPlay
                        className="product-page-look-video"
                      />
                      <div className="product-page-look-info">
                        <img
                          src={creator?.avatar || ''}
                          alt={look.creator}
                          className="product-page-look-avatar"
                        />
                        <div>
                          <span className="product-page-look-creator">{creator?.displayName || look.creator}</span>
                          <span className="product-page-look-title">{look.title}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Similar products */}
          {similarProducts.length > 0 && (
            <div className="product-page-section">
              <h3 className="product-page-section-title">You might also like</h3>
              <div className="product-page-similar">
                {similarProducts.map((p, i) => (
                  <div
                    key={i}
                    className="product-page-similar-item"
                    onClick={() => onOpenProduct ? onOpenProduct(p) : onOpenBrowser(p.url, p.name)}
                  >
                    {p.image ? (
                      <img src={p.image} alt={p.name} className="product-page-similar-img" />
                    ) : (
                      <div className="product-page-similar-placeholder" />
                    )}
                    <span className="product-page-similar-brand">{p.brand}</span>
                    <span className="product-page-similar-name">{p.name}</span>
                    <span className="product-page-similar-price">{p.price}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
