const collections = [
  { name: 'Spring 2026', products: 8, status: 'Active', views: 245 },
  { name: 'Best Sellers', products: 5, status: 'Active', views: 892 },
  { name: 'New Arrivals', products: 3, status: 'Active', views: 134 },
  { name: 'Summer Essentials', products: 0, status: 'Draft', views: 0 },
  { name: 'Sale Items', products: 4, status: 'Active', views: 567 },
];

export default function PartnersCollections() {
  return (
    <div className="partners-page">
      <div className="partners-page-header">
        <h2 className="partners-page-title">Collections</h2>
        <button className="partners-create-campaign-btn" style={{ fontSize: 13, padding: '8px 16px' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Collection
        </button>
      </div>

      <div className="partners-collections-grid">
        {collections.map((col, i) => (
          <div key={i} className="partners-collection-card">
            <div className="partners-collection-img partners-shimmer" />
            <div className="partners-collection-info">
              <h4>{col.name}</h4>
              <span className="partners-collection-meta">{col.products} products</span>
              <div className="partners-collection-footer">
                <span className={`partners-status-badge ${col.status.toLowerCase()}`}>{col.status}</span>
                <span className="partners-collection-views">{col.views} views</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
