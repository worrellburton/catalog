import { useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { useSortableTable, SortableTh } from '~/components/SortableTable';

const creatorsData = [
  { initials: 'AP', name: 'applee', color: '#e8f5e9', sso: 'SSO', createdAt: 'Feb 10, 2026', shopping: 'Men', gender: 'Male', location: 'Milpitas, CA', saved: 1, followers: 0, looks: 0 },
  { initials: 'PH', name: 'PrettyHome', color: '#fce4ec', sso: 'Google', createdAt: 'Feb 07, 2026', shopping: 'Women', gender: 'Female', location: 'Guásimos, VE', saved: 0, followers: 0, looks: 0 },
  { initials: 'TE', name: 'testapple', color: '#e3f2fd', sso: 'SSO', createdAt: 'Feb 03, 2026', shopping: 'Men', gender: 'Male', location: 'San Francisco, CA', saved: 0, followers: 0, looks: 0 },
  { initials: 'AP', name: 'apple', color: '#f3e5f5', sso: 'SSO', createdAt: 'Jan 31, 2026', shopping: 'Men', gender: 'Male', location: '-', saved: 0, followers: 0, looks: 0 },
];

export default function AdminCreators() {
  const [activeTab, setActiveTab] = useState<'creators' | 'incoming'>('creators');
  const { sortedData, sort, handleSort } = useSortableTable(creatorsData);
  const navigate = useNavigate();

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Creators</h1>
        <p className="admin-page-subtitle">Manage platform creators</p>
      </div>
      <div className="admin-tabs">
        <button className={`admin-tab ${activeTab === 'creators' ? 'active' : ''}`} onClick={() => setActiveTab('creators')}>Creators</button>
        <button className={`admin-tab ${activeTab === 'incoming' ? 'active' : ''}`} onClick={() => setActiveTab('incoming')}>
          Incoming
          <span className="admin-tab-badge">0</span>
        </button>
      </div>
      {activeTab === 'creators' ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <SortableTh label="Creator" sortKey="name" currentSort={sort} onSort={handleSort} />
                <SortableTh label="SSO" sortKey="sso" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Joined" sortKey="createdAt" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Shopping" sortKey="shopping" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Gender" sortKey="gender" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Location" sortKey="location" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Saved" sortKey="saved" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Followers" sortKey="followers" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Looks" sortKey="looks" currentSort={sort} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {sortedData.map((c, i) => (
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
      ) : (
        <div className="admin-empty">No incoming creator applications yet</div>
      )}
    </div>
  );
}
