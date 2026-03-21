import { looks, creators } from '~/data/looks';

export default function AdminLooks() {
  const stats = [
    { label: 'Total Looks', value: String(looks.length) },
    { label: 'Total Views', value: '847K' },
    { label: 'Avg. Watch Time', value: '12s' },
    { label: 'Click-Through', value: '4.2%' },
  ];

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Looks</h1>
        <p className="admin-page-subtitle">All look content on the platform</p>
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
              <th>Title</th>
              <th>Creator</th>
              <th>Gender</th>
              <th>Products</th>
              <th>Video</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {looks.map(look => (
              <tr key={look.id}>
                <td className="admin-cell-name">{look.title}</td>
                <td className="admin-cell-muted">{creators[look.creator]?.displayName || look.creator}</td>
                <td>{look.gender}</td>
                <td>{look.products.length}</td>
                <td className="admin-cell-muted">{look.video}</td>
                <td><span className="admin-status admin-status-online">live</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
