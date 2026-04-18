import { useState } from 'react';
import { useSortableTable, SortableTh } from '~/components/SortableTable';

const linksData = [
  { name: 'Creator Invite - Spring', code: 'SPRING26', url: '/join/SPRING26', type: 'Creator', uses: 14, maxUses: 50, status: 'active', createdAt: 'Mar 01, 2026', expiresAt: 'Apr 30, 2026' },
  { name: 'Shopper Referral - Lily', code: 'LILY10', url: '/join/LILY10', type: 'Shopper', uses: 23, maxUses: 100, status: 'active', createdAt: 'Feb 20, 2026', expiresAt: 'May 20, 2026' },
  { name: 'Beta Invite', code: 'BETA2026', url: '/join/BETA2026', type: 'Both', uses: 47, maxUses: 50, status: 'active', createdAt: 'Jan 15, 2026', expiresAt: 'Jun 30, 2026' },
  { name: 'Instagram Bio Link', code: 'IGBIO', url: '/join/IGBIO', type: 'Shopper', uses: 156, maxUses: 500, status: 'active', createdAt: 'Feb 01, 2026', expiresAt: '-' },
  { name: 'TikTok Campaign', code: 'TIKTOK1', url: '/join/TIKTOK1', type: 'Both', uses: 89, maxUses: 200, status: 'active', createdAt: 'Feb 10, 2026', expiresAt: 'Apr 10, 2026' },
  { name: 'Holiday Promo', code: 'HOLIDAY25', url: '/join/HOLIDAY25', type: 'Shopper', uses: 200, maxUses: 200, status: 'expired', createdAt: 'Dec 01, 2025', expiresAt: 'Jan 01, 2026' },
  { name: 'Press Launch', code: 'PRESS', url: '/join/PRESS', type: 'Creator', uses: 8, maxUses: 20, status: 'paused', createdAt: 'Mar 10, 2026', expiresAt: 'Apr 10, 2026' },
];

export default function AdminLinks() {
  const [filter, setFilter] = useState<'all' | 'active' | 'expired' | 'paused'>('all');
  const filtered = filter === 'all' ? linksData : linksData.filter(l => l.status === filter);
  const { sortedData, sort, handleSort } = useSortableTable(filtered);

  const stats = [
    { label: 'Total Links', value: String(linksData.length) },
    { label: 'Active', value: String(linksData.filter(l => l.status === 'active').length) },
    { label: 'Total Uses', value: linksData.reduce((s, l) => s + l.uses, 0).toLocaleString() },
    { label: 'Conversion Rate', value: '34%' },
  ];

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Sign Up Links</h1>
        <p className="admin-page-subtitle">Manage signup and referral links</p>
      </div>
      <div className="admin-stats-grid">
        {stats.map(s => (
          <div key={s.label} className="admin-stat-card">
            <span className="admin-stat-value">{s.value}</span>
            <span className="admin-stat-label">{s.label}</span>
          </div>
        ))}
      </div>
      <div className="admin-tabs">
        <button className={`admin-tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All</button>
        <button className={`admin-tab ${filter === 'active' ? 'active' : ''}`} onClick={() => setFilter('active')}>Active</button>
        <button className={`admin-tab ${filter === 'expired' ? 'active' : ''}`} onClick={() => setFilter('expired')}>Expired</button>
        <button className={`admin-tab ${filter === 'paused' ? 'active' : ''}`} onClick={() => setFilter('paused')}>Paused</button>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <SortableTh label="Name" sortKey="name" currentSort={sort} onSort={handleSort} />
              <SortableTh label="Code" sortKey="code" currentSort={sort} onSort={handleSort} />
              <SortableTh label="Type" sortKey="type" currentSort={sort} onSort={handleSort} />
              <SortableTh label="Uses" sortKey="uses" currentSort={sort} onSort={handleSort} />
              <th>Limit</th>
              <th>Status</th>
              <SortableTh label="Created" sortKey="createdAt" currentSort={sort} onSort={handleSort} />
              <SortableTh label="Expires" sortKey="expiresAt" currentSort={sort} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {sortedData.map(l => (
              <tr key={l.code}>
                <td className="admin-cell-name">{l.name}</td>
                <td><code style={{ fontSize: 11, background: 'rgba(128,128,128,0.08)', padding: '2px 6px', borderRadius: 4 }}>{l.code}</code></td>
                <td><span className="admin-sso-badge">{l.type}</span></td>
                <td>{l.uses}</td>
                <td className="admin-cell-muted">{l.maxUses}</td>
                <td><span className={`admin-status admin-status-${l.status === 'active' ? 'online' : l.status === 'expired' ? 'offline' : 'away'}`}>{l.status}</span></td>
                <td className="admin-cell-muted">{l.createdAt}</td>
                <td className="admin-cell-muted">{l.expiresAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
