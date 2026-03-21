export default function AdminBrands() {
  const stats = [
    { label: 'Total Brands', value: '48' },
    { label: 'Active Partnerships', value: '32' },
    { label: 'Avg. Products/Brand', value: '12' },
    { label: 'Total Revenue', value: '$284K' },
  ];

  const brands = [
    { name: 'Aritzia', products: 8, looks: 14, clicks: '2,847', revenue: '$42,300', status: 'active' },
    { name: 'Zara', products: 12, looks: 9, clicks: '3,102', revenue: '$38,750', status: 'active' },
    { name: 'COS', products: 6, looks: 7, clicks: '1,456', revenue: '$21,200', status: 'active' },
    { name: 'Massimo Dutti', products: 5, looks: 4, clicks: '892', revenue: '$15,400', status: 'active' },
    { name: 'Everlane', products: 9, looks: 11, clicks: '2,203', revenue: '$31,800', status: 'active' },
    { name: 'Reformation', products: 4, looks: 6, clicks: '1,678', revenue: '$28,900', status: 'paused' },
  ];

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Brands</h1>
        <p className="admin-page-subtitle">Brand partnerships and performance</p>
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
              <th>Brand</th>
              <th>Products</th>
              <th>In Looks</th>
              <th>Link Clicks</th>
              <th>Revenue</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {brands.map(b => (
              <tr key={b.name}>
                <td className="admin-cell-name">{b.name}</td>
                <td>{b.products}</td>
                <td>{b.looks}</td>
                <td>{b.clicks}</td>
                <td>{b.revenue}</td>
                <td><span className={`admin-status admin-status-${b.status === 'active' ? 'online' : 'away'}`}>{b.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
