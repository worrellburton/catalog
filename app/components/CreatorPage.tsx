
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

type Tab = 'looks' | 'products' | 'collections';

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
      <button className="creator-back" onClick={onClose}>&larr; Back</button>

      <div className="creator-profile">
        <img
          className="creator-profile-avatar"
          src={creatorData?.avatar || ''}
          alt={creatorData?.displayName || creatorName}
        />
        <div className="creator-profile-info">
          <h1 className="creator-profile-name">{creatorData?.displayName || creatorName}</h1>
          <span className="creator-profile-handle">{creatorName}</span>
          <div className="creator-profile-stats">
            <div className="creator-stat">
              <span className="creator-stat-num">{creatorLooks.length}</span>
              <span className="creator-stat-label">Looks</span>
            </div>
            <div className="creator-stat">
              <span className="creator-stat-num">{creatorProducts.length}</span>
              <span className="creator-stat-label">Products</span>
            </div>
            <div className="creator-stat">
              <span className="creator-stat-num">0</span>
              <span className="creator-stat-label">Collections</span>
            </div>
          </div>
        </div>
      </div>

      <div className="creator-tabs">
        {(['looks', 'products', 'collections'] as Tab[]).map(tab => (
          <button
            key={tab}
            className={`creator-tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

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

      {activeTab === 'products' && (
        <div className="creator-products-grid">
          {creatorProducts.map((p, i) => (
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

      {activeTab === 'collections' && (
        <div className="creator-empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>
          </svg>
          <p>No collections yet</p>
        </div>
      )}
    </div>
  );
}
