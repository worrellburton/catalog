const shoppers = [
  { initials: 'CA', name: 'Carla', color: '#e8f5e9', sso: 'SSO', createdAt: 'Mar 01, 2026 12:18 PM', shopping: 'Women', location: 'Washington, England, United Kingdom', height: '5\'9"', age: '-', saved: 0, followings: 0, invited: 0, creator: '-', enteredVia: '-' },
  { initials: 'AL', name: 'alfvaz', color: '#e3f2fd', sso: 'SSO', createdAt: 'Feb 28, 2026 02:11 PM', shopping: 'Men', location: '-', height: '5\'9"', age: '-', saved: 0, followings: 1, invited: 0, creator: 'Angelina Oleas', enteredVia: 'Angelina Oleas' },
  { initials: 'FR', name: 'franky90', color: '#fff3e0', sso: 'Google', createdAt: 'Feb 28, 2026 02:11 PM', shopping: 'Men', location: '-', height: '5\'9"', age: '-', saved: 0, followings: 1, invited: 0, creator: 'Angelina Oleas', enteredVia: 'Angelina Oleas' },
  { initials: 'D1', name: 'D1.barbershop', color: '#f3e5f5', sso: 'Google', createdAt: 'Feb 25, 2026 11:55 PM', shopping: 'Men', location: '-', height: '5\'9"', age: '-', saved: 0, followings: 0, invited: 0, creator: '-', enteredVia: '-' },
];

export default function AdminShoppers() {
  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Shoppers</h1>
        <p className="admin-page-subtitle">Manage and monitor platform shoppers</p>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Shopper</th>
              <th>SSO</th>
              <th>Email</th>
              <th>Created At</th>
              <th>Shopping</th>
              <th>Location</th>
              <th>Height</th>
              <th>Age</th>
              <th>Saved</th>
              <th>Followings</th>
              <th>Invited</th>
              <th>Creator</th>
              <th>Entered App Via</th>
            </tr>
          </thead>
          <tbody>
            {shoppers.map(s => (
              <tr key={s.name}>
                <td className="admin-cell-name">
                  <span className="admin-user-avatar" style={{ background: s.color }}>{s.initials}</span>
                  {s.name}
                </td>
                <td><span className="admin-sso-badge">{s.sso}</span></td>
                <td>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                </td>
                <td className="admin-cell-muted">{s.createdAt}</td>
                <td>{s.shopping}</td>
                <td className="admin-cell-muted">{s.location}</td>
                <td>{s.height}</td>
                <td>{s.age}</td>
                <td><span className="admin-pill-badge">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                  {s.saved}
                </span></td>
                <td><span className="admin-pill-badge">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                  {s.followings}
                </span></td>
                <td>{s.invited}</td>
                <td className="admin-cell-muted">{s.creator}</td>
                <td className="admin-cell-muted">{s.enteredVia}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
