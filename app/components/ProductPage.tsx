
import { useMemo } from 'react';
import { Product, Look, looks, creators } from '~/data/looks';
import { useEscapeKey } from '~/hooks/useEscapeKey';

interface ProductPageProps {
  product: Product;
  onClose: () => void;
  onOpenLook: (look: Look) => void;
  onOpenBrowser: (url: string, title: string) => void;
}

export default function ProductPage({ product, onClose, onOpenLook, onOpenBrowser }: ProductPageProps) {
  useEscapeKey(onClose);

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

  // Find all looks that contain this product
  const relatedLooks = useMemo(() => {
    return looks.filter(look =>
      look.products.some(p => p.name === product.name && p.brand === product.brand)
    );
  }, [product]);

  // Find similar products (same brand or similar price range)
  const similarProducts = useMemo(() => {
    const allProducts = looks.flatMap(l => l.products);
    const seen = new Set<string>();
    seen.add(`${product.brand}-${product.name}`);
    return allProducts.filter(p => {
      const key = `${p.brand}-${p.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return p.brand === product.brand || Math.abs(parseFloat(p.price.replace(/[^0-9.]/g, '')) - parseFloat(product.price.replace(/[^0-9.]/g, ''))) < 300;
    }).slice(0, 4);
  }, [product]);

  return (
    <div className="product-page-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="product-page">
        <button className="product-page-close" onClick={onClose} aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
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
              >
                Shop Now
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
              </button>
            </div>
          </div>

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
                      onClick={() => { onClose(); onOpenLook(look); }}
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
                    onClick={() => onOpenBrowser(p.url, p.name)}
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
