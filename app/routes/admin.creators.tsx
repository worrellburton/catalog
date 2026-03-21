import { creators } from '~/data/looks';

export default function AdminCreators() {
  const stats = [
    { label: 'Total Creators', value: String(Object.keys(creators).length) },
    { label: 'Active Creators', value: String(Object.keys(creators).length) },
    { label: 'Avg. Looks/Creator', value: '6' },
    { label: 'Total Followers', value: '2.4M' },
  ];

  const creatorList = Object.entries(creators).map(([key, c]) => ({
    key,
    name: c.displayName,
    handle: c.handle,
    avatar: c.avatar,
    looks: 6,
    followers: key === 'lilywittman' ? '1.2M' : '1.2M',
    engagement: key === 'lilywittman' ? '8.4%' : '7.1%',
    status: 'active' as const,
  }));

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Creators</h1>
        <p className="admin-page-subtitle">Manage creator profiles and content</p>
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
              <th>Creator</th>
              <th>Handle</th>
              <th>Looks</th>
              <th>Followers</th>
              <th>Engagement</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {creatorList.map(c => (
              <tr key={c.key}>
                <td className="admin-cell-name">
                  <span className="admin-avatar">{c.avatar}</span>
                  {c.name}
                </td>
                <td className="admin-cell-muted">@{c.handle}</td>
                <td>{c.looks}</td>
                <td>{c.followers}</td>
                <td>{c.engagement}</td>
                <td><span className="admin-status admin-status-online">{c.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
