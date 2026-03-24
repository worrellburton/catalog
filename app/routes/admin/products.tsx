import { looks } from '~/data/looks';

export default function AdminProducts() {
  // Collect all unique products across looks
  const allProducts = looks.flatMap(l => l.products.map(p => ({ ...p, lookTitle: l.title })));
  const uniqueProducts = allProducts.filter((p, i, arr) => arr.findIndex(x => x.name === p.name) === i);

  const stats = [
    { label: 'Total Products', value: String(uniqueProducts.length) },
    { label: 'Brands', value: String(new Set(uniqueProducts.map(p => p.brand)).size) },
    { label: 'Avg. Price', value: `$${Math.round(uniqueProducts.reduce((sum, p) => sum + parseFloat(p.price.replace('$', '')), 0) / uniqueProducts.length)}` },
    { label: 'Link Clicks', value: '14.2K' },
  ];

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Products</h1>
        <p className="admin-page-subtitle">Product catalog and performance</p>
      </div>
      <div className="admin-stats-grid">
        {stats.map(s => (
          <div key={s.label} className="admin-stat-card">
            <span className="admin-stat-value">{s.value}</span>
            <span className="admin-stat-label">{s.label}</span>
          </div>
        ))}
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Brand</th>
              <th>Price</th>
              <th>In Look</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {allProducts.map((p, i) => (
              <tr key={`${p.name}-${i}`}>
                <td className="admin-cell-name">{p.name}</td>
                <td className="admin-cell-muted">{p.brand}</td>
                <td>{p.price}</td>
                <td className="admin-cell-muted">{p.lookTitle}</td>
                <td><span className="admin-status admin-status-online">active</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
