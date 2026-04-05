import { useState, useEffect } from 'react';
import { useNavigate } from '@remix-run/react';
import { useSortableTable, SortableTh } from '~/components/SortableTable';
import { getProfiles, type Profile } from '~/services/profiles';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function profileToShopper(p: Profile) {
  const name = p.full_name || p.email?.split('@')[0] || 'Unknown';
  return {
    initials: name.slice(0, 2).toUpperCase(),
    name,
    color: '#e8f5e9',
    avatar: p.avatar_url || `https://i.pravatar.cc/40?u=${p.id}`,
    sso: p.provider === 'google' ? 'Google' : p.provider === 'phone' ? 'Phone' : 'SSO',
    createdAt: formatDate(p.created_at),
    lastSignIn: formatDateTime(p.last_sign_in_at),
    shopping: '-',
    location: '-',
    saved: 0,
    followings: 0,
    creator: '-',
  };
}

type Tab = 'shoppers' | 'creators' | 'waitlist' | 'incoming';

export default function AdminUsers() {
  const [activeTab, setActiveTab] = useState<Tab>('shoppers');
  const [shoppers, setShoppers] = useState<ReturnType<typeof profileToShopper>[]>([]);

  useEffect(() => {
    getProfiles().then(profiles => setShoppers(profiles.map(profileToShopper)));
  }, []);

  const shopperTable = useSortableTable(shoppers);
  const navigate = useNavigate();

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Users</h1>
        <p className="admin-page-subtitle">Manage shoppers and creators</p>
      </div>
      <div className="admin-tabs">
        <button className={`admin-tab ${activeTab === 'shoppers' ? 'active' : ''}`} onClick={() => setActiveTab('shoppers')}>Shoppers</button>
        <button className={`admin-tab ${activeTab === 'waitlist' ? 'active' : ''}`} onClick={() => setActiveTab('waitlist')}>Waitlist</button>
        <button className={`admin-tab ${activeTab === 'creators' ? 'active' : ''}`} onClick={() => setActiveTab('creators')}>Creators</button>
        <button className={`admin-tab ${activeTab === 'incoming' ? 'active' : ''}`} onClick={() => setActiveTab('incoming')}>Incoming</button>
      </div>

      {activeTab === 'shoppers' && (
        shoppers.length === 0 ? (
          <p className="admin-detail-empty">No shoppers yet</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <SortableTh label="Shopper" sortKey="name" currentSort={shopperTable.sort} onSort={shopperTable.handleSort} />
                  <SortableTh label="SSO" sortKey="sso" currentSort={shopperTable.sort} onSort={shopperTable.handleSort} />
                  <SortableTh label="Joined" sortKey="createdAt" currentSort={shopperTable.sort} onSort={shopperTable.handleSort} />
                  <SortableTh label="Last Sign In" sortKey="lastSignIn" currentSort={shopperTable.sort} onSort={shopperTable.handleSort} />
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
                    onClick={() => navigate(`/admin/user/${encodeURIComponent(s.name)}`)}
                  >
                    <td className="admin-cell-name">
                      <img className="admin-user-avatar-img" src={s.avatar} alt={s.name} />
                      {s.name}
                    </td>
                    <td><span className="admin-sso-badge">{s.sso}</span></td>
                    <td className="admin-cell-muted">{s.createdAt}</td>
                    <td className="admin-cell-muted">{s.lastSignIn}</td>
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
        )
      )}

      {activeTab === 'waitlist' && (
        <p className="admin-detail-empty">No waitlist signups yet</p>
      )}

      {activeTab === 'creators' && (
        <p className="admin-detail-empty">No creators yet</p>
      )}

      {activeTab === 'incoming' && (
        <p className="admin-detail-empty">No incoming creator applications</p>
      )}
    </div>
  );
}
