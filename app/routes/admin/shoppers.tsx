import { useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { useSortableTable, SortableTh } from '~/components/SortableTable';

const shoppers = [
  { initials: 'CA', name: 'Carla', color: '#e8f5e9', sso: 'SSO', createdAt: 'Mar 01, 2026', shopping: 'Women', location: 'Washington, UK', saved: 0, followings: 0, creator: '-' },
  { initials: 'AL', name: 'alfvaz', color: '#e3f2fd', sso: 'SSO', createdAt: 'Feb 28, 2026', shopping: 'Men', location: '-', saved: 0, followings: 1, creator: 'Angelina Oleas' },
  { initials: 'FR', name: 'franky90', color: '#fff3e0', sso: 'Google', createdAt: 'Feb 28, 2026', shopping: 'Men', location: '-', saved: 0, followings: 1, creator: 'Angelina Oleas' },
  { initials: 'D1', name: 'D1.barbershop', color: '#f3e5f5', sso: 'Google', createdAt: 'Feb 25, 2026', shopping: 'Men', location: '-', saved: 0, followings: 0, creator: '-' },
];

export default function AdminShoppers() {
  const [activeTab, setActiveTab] = useState<'active' | 'waitlist'>('active');
  const { sortedData, sort, handleSort } = useSortableTable(shoppers);
  const navigate = useNavigate();

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Shoppers</h1>
        <p className="admin-page-subtitle">Manage and monitor platform shoppers</p>
      </div>
      <div className="admin-tabs">
        <button className={`admin-tab ${activeTab === 'active' ? 'active' : ''}`} onClick={() => setActiveTab('active')}>Active</button>
        <button className={`admin-tab ${activeTab === 'waitlist' ? 'active' : ''}`} onClick={() => setActiveTab('waitlist')}>
          Waitlist
          <span className="admin-tab-badge">9+</span>
        </button>
      </div>
      {activeTab === 'active' ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <SortableTh label="Shopper" sortKey="name" currentSort={sort} onSort={handleSort} />
                <SortableTh label="SSO" sortKey="sso" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Joined" sortKey="createdAt" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Shopping" sortKey="shopping" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Location" sortKey="location" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Saved" sortKey="saved" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Following" sortKey="followings" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Via Creator" sortKey="creator" currentSort={sort} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {sortedData.map(s => (
                <tr
                  key={s.name}
                  className="admin-clickable-row"
                  onClick={() => navigate(`/admin/shoppers/${encodeURIComponent(s.name)}`)}
                >
                  <td className="admin-cell-name">
                    <span className="admin-user-avatar" style={{ background: s.color }}>{s.initials}</span>
                    {s.name}
                  </td>
                  <td><span className="admin-sso-badge">{s.sso}</span></td>
                  <td className="admin-cell-muted">{s.createdAt}</td>
                  <td>{s.shopping}</td>
                  <td className="admin-cell-muted">{s.location}</td>
                  <td>{s.saved}</td>
                  <td>{s.followings}</td>
                  <td className="admin-cell-muted">{s.creator}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="admin-empty">No shoppers on waitlist yet</div>
      )}
    </div>
  );
}
