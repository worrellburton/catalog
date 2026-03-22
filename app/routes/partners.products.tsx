import { useState, useMemo } from 'react';
import { useSortableTable, SortableTh } from '~/components/SortableTable';

const products = [
  { name: 'Rock Style Flap Shoulder Bag', brand: 'Zara', domain: 'zara.com', price: '$49', inventory: 24, status: 'Active', sales: 42, inLooks: 6, creators: 1, saves: 10, clicks: 68 },
  { name: 'Major Shade Cat Eye Sunglasses', brand: 'Windsor', domain: 'windsorstore.com', price: '$10', inventory: 18, status: 'Active', sales: 38, inLooks: 6, creators: 1, saves: 3, clicks: 121 },
  { name: 'Oval D Glitter Case for iPhone 16 Pro', brand: 'Diesel', domain: 'diesel.com', price: '$39', inventory: 56, status: 'Active', sales: 67, inLooks: 6, creators: 1, saves: 4, clicks: 58 },
  { name: 'Cross Pendant Necklace', brand: 'Pavoi', domain: 'pavoi.com', price: '$13', inventory: 31, status: 'Active', sales: 29, inLooks: 6, creators: 1, saves: 17, clicks: 85 },
  { name: 'Patchwork Pointelle Short-Sleeve Shirt', brand: 'Vince', domain: 'vince.com', price: '$568', inventory: 8, status: 'Active', sales: 15, inLooks: 6, creators: 1, saves: 11, clicks: 50 },
  { name: 'Light Blue Straight Leg Jeans', brand: 'Suitsupply', domain: 'suitsupply.com', price: '$199', inventory: 5, status: 'Active', sales: 11, inLooks: 6, creators: 1, saves: 1, clicks: 63 },
  { name: 'B27 Uptown Low-Top Sneaker Gray and White', brand: 'Dior', domain: 'dior.com', price: '$1,200', inventory: 22, status: 'Active', sales: 33, inLooks: 6, creators: 1, saves: 7, clicks: 77 },
  { name: 'Digital Camera', brand: 'Fujifilm', domain: 'fujifilm.com', price: '$1,725', inventory: 0, status: 'Active', sales: 48, inLooks: 6, creators: 1, saves: 11, clicks: 108 },
  { name: 'Atlas Crossbody Bag', brand: 'Atlas', domain: 'atlasleatherco.com', price: '$85', inventory: 44, status: 'Active', sales: 21, inLooks: 4, creators: 2, saves: 8, clicks: 42 },
  { name: 'Canvas Tote - Natural', brand: 'Atlas', domain: 'atlasleatherco.com', price: '$65', inventory: 0, status: 'Draft', sales: 0, inLooks: 0, creators: 0, saves: 0, clicks: 0 },
];

function getBrandLogo(domain: string) {
  return `https://cdn.brandfetch.io/${domain}/w/80/h/80/fallback/lettermark?c=1id3n10pdBTarCHI0db`;
}

export default function PartnersProducts() {
  const [view, setView] = useState<'list' | 'grid'>('list');
  const table = useSortableTable(products);
  const totalInventory = products.reduce((s, p) => s + p.inventory, 0);
  const totalSales = products.reduce((s, p) => s + p.sales, 0);

  return (
    <div className="partners-page">
      <div className="partners-page-header">
        <h2 className="partners-page-title">Products</h2>
        <div className="partners-header-actions">
          <div className="partners-view-toggle">
            <button className={`partners-view-btn ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')} title="List view">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </button>
            <button className={`partners-view-btn ${view === 'grid' ? 'active' : ''}`} onClick={() => setView('grid')} title="Grid view">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            </button>
          </div>
          <button className="partners-create-campaign-btn" style={{ fontSize: 13, padding: '8px 16px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Product
          </button>
        </div>
      </div>

      <div className="partners-stats-row" style={{ marginBottom: 24 }}>
        <div className="partners-stat-card">
          <span className="partners-stat-label">Total Products</span>
          <span className="partners-stat-value">{products.length}</span>
        </div>
        <div className="partners-stat-card">
          <span className="partners-stat-label">In Stock</span>
          <span className="partners-stat-value">{totalInventory}</span>
        </div>
        <div className="partners-stat-card">
          <span className="partners-stat-label">Total Sales</span>
          <span className="partners-stat-value">{totalSales}</span>
        </div>
      </div>

      {view === 'list' ? (
        <div className="partners-campaigns-table-wrap">
          <table className="partners-campaigns-table">
            <thead>
              <tr>
                <th style={{ width: 70, textAlign: 'center' }}>Creative</th>
                <SortableTh label="Product" sortKey="name" currentSort={table.sort} onSort={table.handleSort} />
                <SortableTh label="Brand" sortKey="brand" currentSort={table.sort} onSort={table.handleSort} />
                <SortableTh label="Price" sortKey="price" currentSort={table.sort} onSort={table.handleSort} />
                <SortableTh label="In Looks" sortKey="inLooks" currentSort={table.sort} onSort={table.handleSort} />
                <SortableTh label="Creators" sortKey="creators" currentSort={table.sort} onSort={table.handleSort} />
                <SortableTh label="Saves" sortKey="saves" currentSort={table.sort} onSort={table.handleSort} />
                <SortableTh label="Clicks" sortKey="clicks" currentSort={table.sort} onSort={table.handleSort} />
                <SortableTh label="Status" sortKey="status" currentSort={table.sort} onSort={table.handleSort} />
              </tr>
            </thead>
            <tbody>
              {table.sortedData.map((p, i) => (
                <tr key={i}>
                  <td style={{ textAlign: 'center' }}>
                    <img
                      src={getBrandLogo(p.domain)}
                      alt={p.brand}
                      className="partners-brand-logo"
                    />
                  </td>
                  <td>
                    <div className="partners-product-name-cell">
                      <span className="partners-product-name">{p.name}</span>
                      <span className="partners-product-brand-sub">{p.brand}</span>
                    </div>
                  </td>
                  <td>
                    <div className="partners-brand-cell">
                      <img
                        src={getBrandLogo(p.domain)}
                        alt={p.brand}
                        className="partners-brand-logo-sm"
                      />
                      <span>{p.brand}</span>
                    </div>
                  </td>
                  <td style={{ fontWeight: 600 }}>{p.price}</td>
                  <td>{p.inLooks}</td>
                  <td>{p.creators}</td>
                  <td>{p.saves}</td>
                  <td>{p.clicks}</td>
                  <td>
                    <span className={`partners-status-badge ${p.status === 'Out of Stock' ? 'refunded' : p.status.toLowerCase()}`}>{p.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="partners-grid-view">
          {products.map((p, i) => (
            <div key={i} className="partners-grid-card">
              <div className="partners-grid-card-preview" style={{ background: '#f8f8f8' }}>
                <img
                  src={getBrandLogo(p.domain)}
                  alt={p.brand}
                  style={{ width: 48, height: 48, objectFit: 'contain', borderRadius: 8 }}
                />
              </div>
              <div className="partners-grid-card-body">
                <div className="partners-grid-card-title">{p.name}</div>
                <div className="partners-grid-card-meta">{p.brand}</div>
                <div className="partners-grid-card-stats">
                  <span>{p.price}</span>
                  <span>{p.clicks} clicks</span>
                </div>
                <div className="partners-grid-card-footer">
                  <span className={`partners-status-badge ${p.status === 'Out of Stock' ? 'refunded' : p.status.toLowerCase()}`}>{p.status}</span>
                  <span style={{ fontSize: 12, color: '#888' }}>{p.saves} saves</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
