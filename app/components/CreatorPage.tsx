
import { useMemo, useState } from 'react';
import { looks, creators, Look, Product } from '~/data/looks';
import { useEscapeKey } from '~/hooks/useEscapeKey';
import LookCard from './LookCard';

interface CreatorPageProps {
  creatorName: string;
  onClose: () => void;
  onOpenLook: (look: Look) => void;
  onOpenProduct?: (product: Product) => void;
  onOpenBrowser?: (url: string, title: string) => void;
  onCreateCatalog?: (query: string) => void;
}

type Tab = 'looks' | 'products';

export default function CreatorPage({ creatorName, onClose, onOpenLook, onOpenProduct, onOpenBrowser, onCreateCatalog }: CreatorPageProps) {
  const [activeTab, setActiveTab] = useState<Tab>('looks');
  const creatorData = creators[creatorName];
  const creatorLooks = useMemo(() => looks.filter(l => l.creator === creatorName), [creatorName]);

  const creatorProducts = useMemo(() => {
    const seen = new Set<string>();
    const products: Product[] = [];
    creatorLooks.forEach(look => {
      look.products.forEach(p => {
        const key = `${p.brand}-${p.name}`;
        if (!seen.has(key)) {
          seen.add(key);
          products.push(p);
        }
      });
    });
    return products;
  }, [creatorLooks]);

  // Group products by brand
  const brandCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    creatorProducts.forEach(p => {
      const brand = p.brand || 'Other';
      counts[brand] = (counts[brand] || 0) + 1;
    });
    return counts;
  }, [creatorProducts]);

  const [activeBrand, setActiveBrand] = useState<string | null>(null);

  const filteredProducts = useMemo(() => {
    if (!activeBrand) return creatorProducts;
    return creatorProducts.filter(p => (p.brand || 'Other') === activeBrand);
  }, [creatorProducts, activeBrand]);

  useEscapeKey(onClose);

  const handleProductClick = (p: Product) => {
    if (onOpenProduct) {
      onOpenProduct(p);
    } else if (p.url && onOpenBrowser) {
      onOpenBrowser(p.url, p.name);
    }
  };

  return (
    <div className="creator-page">
      <button className="creator-back" onClick={onClose}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back
      </button>

      {/* Hero — centered profile */}
      <div className="creator-hero">
        <img
          className="creator-hero-avatar"
          src={creatorData?.avatar || ''}
          alt={creatorData?.displayName || creatorName}
        />
        <span className="creator-hero-curated">Curated by</span>
        <h1 className="creator-hero-name">{creatorData?.displayName || creatorName}</h1>
        <button className="creator-follow-btn">Add to Circle</button>
        <p className="creator-hero-trust">Trusted by {Math.floor(Math.random() * 9 + 1)}.{Math.floor(Math.random() * 9)}k shoppers</p>
        <div className="creator-hero-socials">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.98a8.18 8.18 0 004.76 1.52V7.05a4.83 4.83 0 01-1-.36z"/></svg>
        </div>
      </div>

      {/* Navigation tabs */}
      <div className="creator-nav">
        <button
          className={`creator-nav-tab ${activeTab === 'looks' ? 'active' : ''}`}
          onClick={() => setActiveTab('looks')}
        >
          Looks
        </button>
        <button
          className={`creator-nav-tab ${activeTab === 'products' ? 'active' : ''}`}
          onClick={() => setActiveTab('products')}
        >
          Shop
        </button>
      </div>

      {/* Brand filter chips (products tab only) */}
      {activeTab === 'products' && Object.keys(brandCounts).length > 1 && (
        <div className="creator-brand-chips">
          <button
            className={`creator-brand-chip ${!activeBrand ? 'active' : ''}`}
            onClick={() => setActiveBrand(null)}
          >
            All {creatorProducts.length}
          </button>
          {Object.entries(brandCounts).map(([brand, count]) => (
            <button
              key={brand}
              className={`creator-brand-chip ${activeBrand === brand ? 'active' : ''}`}
              onClick={() => setActiveBrand(brand)}
            >
              {brand} {count}
            </button>
          ))}
        </div>
      )}

      {/* Looks grid */}
      {activeTab === 'looks' && (
        <div className="creator-grid">
          {creatorLooks.map(look => (
            <LookCard
              key={look.id}
              look={look}
              className="look-card"
              onOpenLook={onOpenLook}
              onOpenCreator={() => {}}
              onCreateCatalog={onCreateCatalog}
            />
          ))}
        </div>
      )}

      {/* Products grid */}
      {activeTab === 'products' && (
        <div className="creator-products-grid">
          {filteredProducts.map((p, i) => (
            <div
              key={i}
              className="creator-product-card"
              onClick={() => handleProductClick(p)}
            >
              <div className="creator-product-img">
                {p.image ? (
                  <img src={p.image} alt={p.name} />
                ) : (
                  <div className="creator-product-placeholder" />
                )}
              </div>
              <div className="creator-product-info">
                {p.brand && <span className="creator-product-brand">{p.brand}</span>}
                <span className="creator-product-name">{p.name}</span>
                <span className="creator-product-price">{p.price}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
