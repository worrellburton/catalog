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

const waitlistData = [
  { initials: 'JM', name: 'jmartinez', color: '#e0f7fa', avatar: 'https://i.pravatar.cc/40?img=23', email: 'jmartinez@gmail.com', requestedAt: 'Mar 18, 2026', shopping: 'Women', location: 'Miami, FL', referral: 'Instagram' },
  { initials: 'SK', name: 'skhan_style', color: '#f1f8e9', avatar: 'https://i.pravatar.cc/40?img=44', email: 'sarah.k@outlook.com', requestedAt: 'Mar 17, 2026', shopping: 'Women', location: 'London, UK', referral: 'TikTok' },
  { initials: 'RW', name: 'rwilson23', color: '#fce4ec', avatar: 'https://i.pravatar.cc/40?img=68', email: 'rwilson@yahoo.com', requestedAt: 'Mar 16, 2026', shopping: 'Men', location: 'Austin, TX', referral: 'Word of mouth' },
  { initials: 'LT', name: 'lu_tanaka', color: '#e8eaf6', avatar: 'https://i.pravatar.cc/40?img=9', email: 'lu.tanaka@gmail.com', requestedAt: 'Mar 15, 2026', shopping: 'Women', location: 'Tokyo, JP', referral: 'Instagram' },
  { initials: 'MG', name: 'mgomez_fit', color: '#fff8e1', avatar: 'https://i.pravatar.cc/40?img=53', email: 'mgomez@hotmail.com', requestedAt: 'Mar 14, 2026', shopping: 'Men', location: 'Mexico City, MX', referral: 'Friend' },
  { initials: 'AB', name: 'anna.b', color: '#e0f2f1', avatar: 'https://i.pravatar.cc/40?img=32', email: 'anna.b@gmail.com', requestedAt: 'Mar 13, 2026', shopping: 'Women', location: 'Berlin, DE', referral: 'TikTok' },
  { initials: 'DP', name: 'dpark_nyc', color: '#fbe9e7', avatar: 'https://i.pravatar.cc/40?img=61', email: 'dpark@gmail.com', requestedAt: 'Mar 12, 2026', shopping: 'Men', location: 'New York, NY', referral: 'Instagram' },
  { initials: 'CL', name: 'chloe.lee', color: '#f3e5f5', avatar: 'https://i.pravatar.cc/40?img=26', email: 'chloe.lee@icloud.com', requestedAt: 'Mar 11, 2026', shopping: 'Women', location: 'Seoul, KR', referral: 'Pinterest' },
  { initials: 'NK', name: 'nkumar99', color: '#e3f2fd', avatar: 'https://i.pravatar.cc/40?img=57', email: 'nkumar@gmail.com', requestedAt: 'Mar 10, 2026', shopping: 'Men', location: 'Mumbai, IN', referral: 'Twitter' },
];

const creatorsData = [
  { initials: 'AP', name: 'applee', color: '#e8f5e9', avatar: 'https://i.pravatar.cc/40?img=11', sso: 'SSO', createdAt: 'Feb 10, 2026', shopping: 'Men', gender: 'Male', location: 'Milpitas, CA', saved: 1, followers: 0, looks: 0 },
  { initials: 'PH', name: 'PrettyHome', color: '#fce4ec', avatar: 'https://i.pravatar.cc/40?img=29', sso: 'Google', createdAt: 'Feb 07, 2026', shopping: 'Women', gender: 'Female', location: 'Guásimos, VE', saved: 0, followers: 0, looks: 0 },
  { initials: 'TE', name: 'testapple', color: '#e3f2fd', avatar: 'https://i.pravatar.cc/40?img=51', sso: 'SSO', createdAt: 'Feb 03, 2026', shopping: 'Men', gender: 'Male', location: 'San Francisco, CA', saved: 0, followers: 0, looks: 0 },
  { initials: 'AP', name: 'apple', color: '#f3e5f5', avatar: 'https://i.pravatar.cc/40?img=7', sso: 'SSO', createdAt: 'Jan 31, 2026', shopping: 'Men', gender: 'Male', location: '-', saved: 0, followers: 0, looks: 0 },
];

const incomingCreators = [
  { initials: 'EM', name: 'ella.mood', color: '#e8eaf6', avatar: 'https://i.pravatar.cc/40?img=36', email: 'ella@mood.co', appliedAt: 'Mar 19, 2026', platform: 'Instagram', followers: '12.4K', niche: 'Fashion' },
  { initials: 'TJ', name: 'tj_captures', color: '#fff3e0', avatar: 'https://i.pravatar.cc/40?img=14', email: 'tj@captures.io', appliedAt: 'Mar 18, 2026', platform: 'TikTok', followers: '8.2K', niche: 'Streetwear' },
  { initials: 'YL', name: 'yuna.looks', color: '#fce4ec', avatar: 'https://i.pravatar.cc/40?img=20', email: 'yuna@looks.kr', appliedAt: 'Mar 17, 2026', platform: 'YouTube', followers: '45K', niche: 'Minimal style' },
];

type Tab = 'shoppers' | 'creators' | 'waitlist' | 'incoming';

export default function AdminUsers() {
  const [activeTab, setActiveTab] = useState<Tab>('shoppers');
  const [shoppers, setShoppers] = useState<ReturnType<typeof profileToShopper>[]>([]);

  useEffect(() => {
    getProfiles().then(profiles => setShoppers(profiles.map(profileToShopper)));
  }, []);

  const shopperTable = useSortableTable(shoppers);
  const creatorTable = useSortableTable(creatorsData);
  const waitlistTable = useSortableTable(waitlistData);
  const incomingTable = useSortableTable(incomingCreators);
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
          <span className="admin-tab-badge">{waitlistData.length}+</span>
        </button>
        <button className={`admin-tab ${activeTab === 'creators' ? 'active' : ''}`} onClick={() => setActiveTab('creators')}>Creators</button>
        <button className={`admin-tab ${activeTab === 'incoming' ? 'active' : ''}`} onClick={() => setActiveTab('incoming')}>
          Incoming
          <span className="admin-tab-badge">{incomingCreators.length}</span>
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
      )}

      {activeTab === 'waitlist' && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <SortableTh label="User" sortKey="name" currentSort={waitlistTable.sort} onSort={waitlistTable.handleSort} />
                <SortableTh label="Email" sortKey="email" currentSort={waitlistTable.sort} onSort={waitlistTable.handleSort} />
                <SortableTh label="Requested" sortKey="requestedAt" currentSort={waitlistTable.sort} onSort={waitlistTable.handleSort} />
                <SortableTh label="Shopping" sortKey="shopping" currentSort={waitlistTable.sort} onSort={waitlistTable.handleSort} />
                <SortableTh label="Location" sortKey="location" currentSort={waitlistTable.sort} onSort={waitlistTable.handleSort} />
                <SortableTh label="Referral" sortKey="referral" currentSort={waitlistTable.sort} onSort={waitlistTable.handleSort} />
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {waitlistTable.sortedData.map(w => (
                <tr key={w.name}>
                  <td className="admin-cell-name">
                    <img className="admin-user-avatar-img" src={w.avatar} alt={w.name} />
                    {w.name}
                  </td>
                  <td className="admin-cell-muted">{w.email}</td>
                  <td className="admin-cell-muted">{w.requestedAt}</td>
                  <td>{w.shopping}</td>
                  <td className="admin-cell-muted">{w.location}</td>
                  <td className="admin-cell-muted">{w.referral}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="admin-action-btn approve">Approve</button>
                      <button className="admin-action-btn deny">Deny</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
                  onClick={() => navigate(`/admin/user/${encodeURIComponent(c.name)}`)}
                >
                  <td className="admin-cell-name">
                    <img className="admin-user-avatar-img" src={c.avatar} alt={c.name} />
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
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <SortableTh label="Creator" sortKey="name" currentSort={incomingTable.sort} onSort={incomingTable.handleSort} />
                <SortableTh label="Email" sortKey="email" currentSort={incomingTable.sort} onSort={incomingTable.handleSort} />
                <SortableTh label="Applied" sortKey="appliedAt" currentSort={incomingTable.sort} onSort={incomingTable.handleSort} />
                <SortableTh label="Platform" sortKey="platform" currentSort={incomingTable.sort} onSort={incomingTable.handleSort} />
                <SortableTh label="Followers" sortKey="followers" currentSort={incomingTable.sort} onSort={incomingTable.handleSort} />
                <SortableTh label="Niche" sortKey="niche" currentSort={incomingTable.sort} onSort={incomingTable.handleSort} />
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {incomingTable.sortedData.map(c => (
                <tr key={c.name}>
                  <td className="admin-cell-name">
                    <img className="admin-user-avatar-img" src={c.avatar} alt={c.name} />
                    {c.name}
                  </td>
                  <td className="admin-cell-muted">{c.email}</td>
                  <td className="admin-cell-muted">{c.appliedAt}</td>
                  <td>{c.platform}</td>
                  <td>{c.followers}</td>
                  <td className="admin-cell-muted">{c.niche}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="admin-action-btn approve">Approve</button>
                      <button className="admin-action-btn deny">Deny</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
