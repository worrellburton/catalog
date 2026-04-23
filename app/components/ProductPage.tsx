import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Product, Look, looks as hardcodedLooks } from '~/data/looks';
import { useEscapeKey } from '~/hooks/useEscapeKey';

interface ProductPageCreative {
  videoUrl: string;
  thumbnailUrl?: string | null;
}

interface ProductPageProps {
  product: Product;
  onClose: () => void;
  onOpenLook: (look: Look) => void;
  onOpenBrowser: (url: string, title: string) => void;
  onOpenProduct?: (product: Product) => void;
  onOpenCreator?: (name: string) => void;
  onCreateCatalog?: (query: string) => void;
  creative?: ProductPageCreative;
  similarProductsOverride?: Product[];
}

export default function ProductPage({
  product,
  onClose,
  onOpenBrowser,
  onOpenProduct,
  onCreateCatalog,
  creative,
  similarProductsOverride,
}: ProductPageProps) {
  const [mounted, setMounted] = useState(false);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  // Reset scroll to top when the product changes (user tapped a similar
  // product and we swapped state in-place).
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [product.brand, product.name]);

  const handleClose = useCallback(() => {
    setIsAnimatingOut(true);
    setTimeout(onClose, 320);
  }, [onClose]);

  useEscapeKey(handleClose);

  // Similar products: the parent ideally passes a DB-queried list via
  // `similarProductsOverride`. If it doesn't, fall back to any product in
  // the hardcoded look catalog whose brand matches (same vibe), then any
  // other product.
  const similarProducts = useMemo<Product[]>(() => {
    if (similarProductsOverride && similarProductsOverride.length > 0) {
      return similarProductsOverride
        .filter(p => !(p.brand === product.brand && p.name === product.name))
        .slice(0, 24);
    }
    const all = hardcodedLooks.flatMap(l => l.products);
    const seen = new Set<string>([`${product.brand}-${product.name}`]);
    const sameBrand: Product[] = [];
    const others: Product[] = [];
    for (const p of all) {
      const key = `${p.brand}-${p.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (p.brand === product.brand) sameBrand.push(p);
      else others.push(p);
    }
    return [...sameBrand, ...others].slice(0, 24);
  }, [product, similarProductsOverride]);

  const heroClassName = `pd-hero${creative ? ' pd-hero--video' : product.image ? ' pd-hero--image' : ' pd-hero--empty'}`;

  return (
    <div
      className={`product-page-overlay${mounted && !isAnimatingOut ? ' product-page-overlay--in' : ''}${isAnimatingOut ? ' product-page-overlay--out' : ''}`}
      role="dialog"
      aria-modal="true"
    >
      <div className="product-page" ref={scrollerRef}>
        <button
          className="pd-back"
          onClick={handleClose}
          aria-label="Back"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <section className={heroClassName}>
          {creative ? (
            <video
              src={creative.videoUrl}
              poster={creative.thumbnailUrl ?? undefined}
              autoPlay
              muted
              loop
              playsInline
              className="pd-hero-media"
            />
          ) : product.image ? (
            <img
              src={product.image.replace('w=200&h=200', 'w=1200&h=1600')}
              alt={product.name}
              className="pd-hero-media"
            />
          ) : (
            <div className="pd-hero-placeholder" />
          )}
          <div className="pd-hero-scrim" />
        </section>

        <section className="pd-info">
          <div className="pd-info-inner">
            {product.brand && <div className="pd-brand">{product.brand}</div>}
            <h1 className="pd-name">{product.name}</h1>
            {product.price && <div className="pd-price">{product.price}</div>}
            <div className="pd-actions">
              <button
                type="button"
                className="pd-shop-btn"
                onClick={() => product.url && onOpenBrowser(product.url, product.name)}
                disabled={!product.url}
              >
                Shop on {product.brand || 'site'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="7" y1="17" x2="17" y2="7" />
                  <polyline points="7 7 17 7 17 17" />
                </svg>
              </button>
              {onCreateCatalog && (
                <button
                  type="button"
                  className="pd-ghost-btn"
                  onClick={() => onCreateCatalog(product.brand)}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="9" y1="21" x2="9" y2="9" />
                  </svg>
                  Create catalog
                </button>
              )}
            </div>
          </div>
        </section>

        {similarProducts.length > 0 && (
          <section className="pd-feed">
            <h2 className="pd-feed-title">You might also like</h2>
            <div className="pd-feed-grid">
              {similarProducts.map((p, i) => (
                <button
                  key={`${p.brand}-${p.name}-${i}`}
                  type="button"
                  className="pd-feed-item"
                  onClick={() => (onOpenProduct ? onOpenProduct(p) : onOpenBrowser(p.url, p.name))}
                >
                  <div className="pd-feed-img-wrap">
                    {p.image ? (
                      <img src={p.image} alt={p.name} className="pd-feed-img" />
                    ) : (
                      <div className="pd-feed-img-placeholder" />
                    )}
                  </div>
                  <div className="pd-feed-meta">
                    {p.brand && <span className="pd-feed-brand">{p.brand}</span>}
                    <span className="pd-feed-name">{p.name}</span>
                    {p.price && <span className="pd-feed-price">{p.price}</span>}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

      </div>
    </div>
  );
}
