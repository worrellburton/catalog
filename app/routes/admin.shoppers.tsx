export default function AdminShoppers() {
  const stats = [
    { label: 'Total Shoppers', value: '12,847' },
    { label: 'Active Today', value: '1,293' },
    { label: 'New This Week', value: '384' },
    { label: 'Avg. Session', value: '4m 32s' },
  ];

  const shoppers = [
    { name: 'Sarah Chen', email: 'sarah.c@email.com', looks: 24, saved: 12, lastActive: '2 min ago', status: 'online' },
    { name: 'Marcus Johnson', email: 'marcus.j@email.com', looks: 18, saved: 7, lastActive: '15 min ago', status: 'online' },
    { name: 'Emma Williams', email: 'emma.w@email.com', looks: 45, saved: 23, lastActive: '1 hr ago', status: 'away' },
    { name: 'Alex Rivera', email: 'alex.r@email.com', looks: 8, saved: 3, lastActive: '3 hrs ago', status: 'offline' },
    { name: 'Jordan Lee', email: 'jordan.l@email.com', looks: 31, saved: 15, lastActive: '5 hrs ago', status: 'offline' },
    { name: 'Priya Patel', email: 'priya.p@email.com', looks: 52, saved: 28, lastActive: '1 day ago', status: 'offline' },
  ];

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Shoppers</h1>
        <p className="admin-page-subtitle">Manage and monitor platform shoppers</p>
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
              <th>Name</th>
              <th>Email</th>
              <th>Looks Viewed</th>
              <th>Items Saved</th>
              <th>Last Active</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shoppers.map(s => (
              <tr key={s.email}>
                <td className="admin-cell-name">{s.name}</td>
                <td className="admin-cell-muted">{s.email}</td>
                <td>{s.looks}</td>
                <td>{s.saved}</td>
                <td className="admin-cell-muted">{s.lastActive}</td>
                <td><span className={`admin-status admin-status-${s.status}`}>{s.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
