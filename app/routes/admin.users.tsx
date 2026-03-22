import { useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { useSortableTable, SortableTh } from '~/components/SortableTable';

const shoppers = [
  { initials: 'CA', name: 'Carla', color: '#e8f5e9', sso: 'SSO', createdAt: 'Mar 01, 2026', shopping: 'Women', location: 'Washington, UK', saved: 0, followings: 0, creator: '-' },
  { initials: 'AL', name: 'alfvaz', color: '#e3f2fd', sso: 'SSO', createdAt: 'Feb 28, 2026', shopping: 'Men', location: '-', saved: 0, followings: 1, creator: 'Angelina Oleas' },
  { initials: 'FR', name: 'franky90', color: '#fff3e0', sso: 'Google', createdAt: 'Feb 28, 2026', shopping: 'Men', location: '-', saved: 0, followings: 1, creator: 'Angelina Oleas' },
  { initials: 'D1', name: 'D1.barbershop', color: '#f3e5f5', sso: 'Google', createdAt: 'Feb 25, 2026', shopping: 'Men', location: '-', saved: 0, followings: 0, creator: '-' },
];

const creatorsData = [
  { initials: 'AP', name: 'applee', color: '#e8f5e9', sso: 'SSO', createdAt: 'Feb 10, 2026', shopping: 'Men', gender: 'Male', location: 'Milpitas, CA', saved: 1, followers: 0, looks: 0 },
  { initials: 'PH', name: 'PrettyHome', color: '#fce4ec', sso: 'Google', createdAt: 'Feb 07, 2026', shopping: 'Women', gender: 'Female', location: 'Guásimos, VE', saved: 0, followers: 0, looks: 0 },
  { initials: 'TE', name: 'testapple', color: '#e3f2fd', sso: 'SSO', createdAt: 'Feb 03, 2026', shopping: 'Men', gender: 'Male', location: 'San Francisco, CA', saved: 0, followers: 0, looks: 0 },
  { initials: 'AP', name: 'apple', color: '#f3e5f5', sso: 'SSO', createdAt: 'Jan 31, 2026', shopping: 'Men', gender: 'Male', location: '-', saved: 0, followers: 0, looks: 0 },
];

type Tab = 'shoppers' | 'creators' | 'waitlist' | 'incoming';

export default function AdminUsers() {
  const [activeTab, setActiveTab] = useState<Tab>('shoppers');
  const shopperTable = useSortableTable(shoppers);
  const creatorTable = useSortableTable(creatorsData);
  const navigate = useNavigate();

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Users</h1>
        <p className="admin-page-subtitle">Manage shoppers and creators</p>
      </div>
      <div className="admin-tabs">
        <button className={`admin-tab ${activeTab === 'shoppers' ? 'active' : ''}`} onClick={() => setActiveTab('shoppers')}>Shoppers</button>
        <button className={`admin-tab ${activeTab === 'waitlist' ? 'active' : ''}`} onClick={() => setActiveTab('waitlist')}>
          Waitlist
          <span className="admin-tab-badge">9+</span>
        </button>
        <button className={`admin-tab ${activeTab === 'creators' ? 'active' : ''}`} onClick={() => setActiveTab('creators')}>Creators</button>
        <button className={`admin-tab ${activeTab === 'incoming' ? 'active' : ''}`} onClick={() => setActiveTab('incoming')}>
          Incoming
          <span className="admin-tab-badge">0</span>
        </button>
      </div>

      {activeTab === 'shoppers' && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <SortableTh label="Shopper" sortKey="name" currentSort={shopperTable.sort} onSort={shopperTable.handleSort} />
                <SortableTh label="SSO" sortKey="sso" currentSort={shopperTable.sort} onSort={shopperTable.handleSort} />
                <SortableTh label="Joined" sortKey="createdAt" currentSort={shopperTable.sort} onSort={shopperTable.handleSort} />
                <SortableTh label="Shopping" sortKey="shopping" currentSort={shopperTable.sort} onSort={shopperTable.handleSort} />
                <SortableTh label="Location" sortKey="location" currentSort={shopperTable.sort} onSort={shopperTable.handleSort} />
                <SortableTh label="Saved" sortKey="saved" currentSort={shopperTable.sort} onSort={shopperTable.handleSort} />
                <SortableTh label="Following" sortKey="followings" currentSort={shopperTable.sort} onSort={shopperTable.handleSort} />
                <SortableTh label="Via Creator" sortKey="creator" currentSort={shopperTable.sort} onSort={shopperTable.handleSort} />
              </tr>
            </thead>
            <tbody>
              {shopperTable.sortedData.map(s => (
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
      )}

      {activeTab === 'waitlist' && (
        <div className="admin-empty">No shoppers on waitlist yet</div>
      )}

      {activeTab === 'creators' && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <SortableTh label="Creator" sortKey="name" currentSort={creatorTable.sort} onSort={creatorTable.handleSort} />
                <SortableTh label="SSO" sortKey="sso" currentSort={creatorTable.sort} onSort={creatorTable.handleSort} />
                <SortableTh label="Joined" sortKey="createdAt" currentSort={creatorTable.sort} onSort={creatorTable.handleSort} />
                <SortableTh label="Shopping" sortKey="shopping" currentSort={creatorTable.sort} onSort={creatorTable.handleSort} />
                <SortableTh label="Gender" sortKey="gender" currentSort={creatorTable.sort} onSort={creatorTable.handleSort} />
                <SortableTh label="Location" sortKey="location" currentSort={creatorTable.sort} onSort={creatorTable.handleSort} />
                <SortableTh label="Saved" sortKey="saved" currentSort={creatorTable.sort} onSort={creatorTable.handleSort} />
                <SortableTh label="Followers" sortKey="followers" currentSort={creatorTable.sort} onSort={creatorTable.handleSort} />
                <SortableTh label="Looks" sortKey="looks" currentSort={creatorTable.sort} onSort={creatorTable.handleSort} />
              </tr>
            </thead>
            <tbody>
              {creatorTable.sortedData.map((c, i) => (
                <tr
                  key={`${c.name}-${i}`}
                  className="admin-clickable-row"
                  onClick={() => navigate(`/admin/creators/${encodeURIComponent(c.name)}`)}
                >
                  <td className="admin-cell-name">
                    <span className="admin-user-avatar" style={{ background: c.color }}>{c.initials}</span>
                    {c.name}
                  </td>
                  <td><span className="admin-sso-badge">{c.sso}</span></td>
                  <td className="admin-cell-muted">{c.createdAt}</td>
                  <td>{c.shopping}</td>
                  <td>{c.gender}</td>
                  <td className="admin-cell-muted">{c.location}</td>
                  <td>{c.saved}</td>
                  <td>{c.followers}</td>
                  <td>{c.looks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'incoming' && (
        <div className="admin-empty">No incoming creator applications yet</div>
      )}
    </div>
  );
}
