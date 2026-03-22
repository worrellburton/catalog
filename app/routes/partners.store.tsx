export default function PartnersStore() {
  return (
    <div className="partners-page">
      <h2 className="partners-page-title">Store</h2>

      <div className="partners-stats-row" style={{ marginBottom: 24 }}>
        <div className="partners-stat-card">
          <span className="partners-stat-label">Store Views</span>
          <span className="partners-stat-value">342</span>
          <span className="partners-stat-change">+28 today</span>
        </div>
        <div className="partners-stat-card">
          <span className="partners-stat-label">Conversion Rate</span>
          <span className="partners-stat-value">3.2%</span>
          <span className="partners-stat-change">+0.4% vs last week</span>
        </div>
        <div className="partners-stat-card">
          <span className="partners-stat-label">Active Products</span>
          <span className="partners-stat-value">12</span>
          <span className="partners-stat-change">+2 this month</span>
        </div>
      </div>

      <div className="partners-section-card">
        <h3 className="partners-section-title" style={{ textAlign: 'left' }}>Store Preview</h3>
        <div className="partners-store-preview">
          <div className="partners-store-banner partners-shimmer" />
          <div className="partners-store-products-grid">
            {['Atlas Crossbody Bag', 'Canvas Tote - Natural', 'Leather Wallet', 'Atlas Weekender', 'Belt Bag', 'Atlas Backpack'].map((name, i) => (
              <div key={i} className="partners-store-product">
                <div className="partners-store-product-img partners-shimmer" />
                <div className="partners-store-product-name">{name}</div>
                <div className="partners-store-product-price">${[85, 65, 45, 195, 55, 210][i]}.00</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
