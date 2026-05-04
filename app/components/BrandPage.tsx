import { useEffect, useMemo, useState } from 'react';
import CreativeCard from './CreativeCard';
import { useEscapeKey } from '~/hooks/useEscapeKey';
import { getCreativesByBrand, type ProductAd } from '~/services/product-creative';

interface BrandPageProps {
  brandName: string;
  onClose: () => void;
  /** Forwarded to each CreativeCard so taps drill into the existing
   *  product detail overlay (the same drill-down pattern used by the
   *  main consumer feed). */
  onOpenProduct: (creative: ProductAd) => void;
}

/* Brand catalog page.
 *
 * Same drill-down discovery pattern as the consumer feed: a grid of
 * CreativeCards filtered to a single brand. Tapping a card opens the
 * existing ProductPage modal - closing it returns to the brand page.
 *
 * Data is loaded live from product_creative joined to products on
 * brand. The CreatorPage equivalent uses static seed data (legacy);
 * this one targets the live catalog so brand discovery reflects the
 * actual ad inventory.
 */
export default function BrandPage({ brandName, onClose, onOpenProduct }: BrandPageProps) {
  const [creatives, setCreatives] = useState<ProductAd[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEscapeKey(onClose);

  // Load all live creatives for this brand. Using a high cap rather
  // than paginating - most brands have well under 200 ads, and a
  // single fetch keeps the grid scrolling free of pagination jank.
  useEffect(() => {
    let cancelled = false;
    setCreatives(null);
    setLoadError(null);
    getCreativesByBrand(brandName, null, 200)
      .then(rows => { if (!cancelled) setCreatives(rows); })
      .catch(err => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load brand catalog');
        setCreatives([]);
      });
    return () => { cancelled = true; };
  }, [brandName]);

  // Lock background scroll while the brand page is mounted (same as
  // ProductPage / CreatorPage). The overlay uses its own scroll.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const productCount = useMemo(() => {
    if (!creatives) return null;
    // Dedupe by product_id - a product may have multiple creatives.
    const seen = new Set<string>();
    for (const c of creatives) {
      if (c.product_id) seen.add(c.product_id);
    }
    return seen.size;
  }, [creatives]);

  const loading = creatives === null;
  const empty = !loading && (creatives?.length ?? 0) === 0;

  return (
    <div className="brand-page">
      <button className="brand-back" onClick={onClose} aria-label="Back">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back
      </button>

      {/* Hero - brand name + count, mirrors the editorial Catalog
          header treatment. */}
      <div className="brand-hero">
        <span className="brand-hero-eyebrow">Catalog</span>
        <h1 className="brand-hero-name">{brandName}</h1>
        <p className="brand-hero-meta">
          {loading
            ? 'Loading…'
            : productCount === 0
              ? 'No products yet'
              : `${productCount} product${productCount === 1 ? '' : 's'}`}
        </p>
      </div>

      {/* Grid - same CreativeCard the main feed uses so the visual
          language is identical (lazy video, hover, tap to open). */}
      {loading && (
        <div className="brand-grid is-loading" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="brand-grid-skeleton" />
          ))}
        </div>
      )}

      {empty && (
        <div className="brand-empty">
          <p>{loadError ? `Couldn't load ${brandName}: ${loadError}` : `No products from ${brandName} yet.`}</p>
        </div>
      )}

      {!loading && !empty && (
        <div className="brand-grid">
          {creatives!.map(c => (
            <CreativeCard
              key={c.id}
              creative={c}
              className="look-card"
              onOpenProduct={onOpenProduct}
            />
          ))}
        </div>
      )}
    </div>
  );
}
