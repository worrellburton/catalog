const creatorsData = [
  { initials: 'AP', name: 'applee', color: '#e8f5e9', sso: 'SSO', createdAt: 'Feb 10, 2026 10:26 AM', shopping: 'Men', gender: 'Male', location: 'Milpitas, California, United States', height: '5\'9"', age: '0 years', saved: 1, followings: 0, followers: 0, looks: 0 },
  { initials: 'PH', name: 'PrettyHome', color: '#fce4ec', sso: 'Google', createdAt: 'Feb 07, 2026 10:09 AM', shopping: 'Women', gender: 'Female', location: 'Guásimos, Venezuela', height: '5\'9"', age: '0 years', saved: 0, followings: 0, followers: 0, looks: 0 },
  { initials: 'TE', name: 'testapple', color: '#e3f2fd', sso: 'SSO', createdAt: 'Feb 03, 2026 11:59 PM', shopping: 'Men', gender: 'Male', location: 'San Francisco, California, United States', height: '5\'9"', age: '0 years', saved: 0, followings: 1, followers: 0, looks: 0 },
  { initials: 'AP', name: 'apple', color: '#f3e5f5', sso: 'SSO', createdAt: 'Jan 31, 2026 01:51 PM', shopping: 'Men', gender: 'Male', location: '-', height: '5\'9"', age: '-', saved: 0, followings: 0, followers: 0, looks: 0 },
];

export default function AdminCreators() {
  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Creators</h1>
        <p className="admin-page-subtitle">Manage platform creators</p>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Creator</th>
              <th>SSO</th>
              <th>Email</th>
              <th>Created At</th>
              <th>Shopping</th>
              <th>Gender</th>
              <th>Location</th>
              <th>Height</th>
              <th>Age</th>
              <th>Saved</th>
              <th>Followings</th>
              <th>Followers</th>
              <th>Looks</th>
            </tr>
          </thead>
          <tbody>
            {creatorsData.map((c, i) => (
              <tr key={`${c.name}-${i}`}>
                <td className="admin-cell-name">
                  <span className="admin-user-avatar" style={{ background: c.color }}>{c.initials}</span>
                  {c.name}
                </td>
                <td><span className="admin-sso-badge">{c.sso}</span></td>
                <td>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                </td>
                <td className="admin-cell-muted">{c.createdAt}</td>
                <td>{c.shopping}</td>
                <td>{c.gender}</td>
                <td className="admin-cell-muted">{c.location}</td>
                <td>{c.height}</td>
                <td>{c.age}</td>
                <td><span className="admin-pill-badge">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                  {c.saved}
                </span></td>
                <td><span className="admin-pill-badge">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                  {c.followings}
                </span></td>
                <td><span className="admin-pill-badge">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                  {c.followers}
                </span></td>
                <td><span className="admin-pill-badge">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/></svg>
                  {c.looks}
                </span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
