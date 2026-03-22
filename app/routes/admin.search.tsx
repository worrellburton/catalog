export default function AdminSearch() {
  const topSearches = [
    { term: 'summer dresses', count: 342, trend: '+18%', results: 12 },
    { term: 'streetwear', count: 289, trend: '+5%', results: 8 },
    { term: 'dior sneakers', count: 234, trend: '+42%', results: 3 },
    { term: 'white sneakers', count: 198, trend: '-2%', results: 6 },
    { term: 'linen pants', count: 176, trend: '+12%', results: 4 },
    { term: 'casual outfits', count: 165, trend: '+8%', results: 15 },
    { term: 'minimalist style', count: 154, trend: '+22%', results: 9 },
    { term: 'mens fashion', count: 143, trend: '-5%', results: 7 },
    { term: 'zara bag', count: 132, trend: '+31%', results: 2 },
    { term: 'date night outfit', count: 121, trend: '+15%', results: 5 },
  ];

  const zeroResults = [
    { term: 'nike air max', count: 87, lastSearched: 'Mar 21, 2026' },
    { term: 'vintage denim', count: 64, lastSearched: 'Mar 20, 2026' },
    { term: 'louis vuitton', count: 52, lastSearched: 'Mar 21, 2026' },
    { term: 'corset top', count: 41, lastSearched: 'Mar 19, 2026' },
    { term: 'cargo pants wide', count: 38, lastSearched: 'Mar 18, 2026' },
  ];

  const searchByTime = [
    { hour: '12am-4am', searches: 120, pct: 3 },
    { hour: '4am-8am', searches: 340, pct: 8 },
    { hour: '8am-12pm', searches: 1250, pct: 28 },
    { hour: '12pm-4pm', searches: 980, pct: 22 },
    { hour: '4pm-8pm', searches: 1100, pct: 25 },
    { hour: '8pm-12am', searches: 610, pct: 14 },
  ];

  const recentSearches = [
    { user: 'Carla', term: 'summer dresses', time: '2 min ago', clicked: true },
    { user: 'alfvaz', term: 'dior sneakers', time: '5 min ago', clicked: true },
    { user: 'franky90', term: 'casual outfits', time: '8 min ago', clicked: false },
    { user: 'D1.barbershop', term: 'barber supplies', time: '12 min ago', clicked: false },
    { user: 'Carla', term: 'white sneakers', time: '15 min ago', clicked: true },
    { user: 'alfvaz', term: 'streetwear', time: '22 min ago', clicked: true },
    { user: 'franky90', term: 'jeans', time: '30 min ago', clicked: false },
    { user: 'Carla', term: 'linen pants', time: '45 min ago', clicked: true },
  ];

  const stats = [
    { label: 'Total Searches', value: '4,400' },
    { label: 'Unique Terms', value: '892' },
    { label: 'Avg. Results', value: '7.2' },
    { label: 'Click-through', value: '62%' },
    { label: 'Zero Results', value: '14%' },
    { label: 'Searches/User', value: '3.8' },
  ];

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Search</h1>
        <p className="admin-page-subtitle">Search analytics and discovery insights</p>
      </div>

      <div className="admin-stats-grid">
        {stats.map(s => (
          <div key={s.label} className="admin-stat-card">
            <span className="admin-stat-value">{s.value}</span>
            <span className="admin-stat-label">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="admin-detail-grid" style={{ marginTop: 20 }}>
        {/* Top Searches */}
        <div className="admin-detail-card">
          <h3>Top Searches</h3>
          <div className="admin-table-wrap" style={{ border: 'none', borderRadius: 0, marginTop: 8 }}>
            <table className="admin-table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Term</th>
                  <th>Count</th>
                  <th>Trend</th>
                  <th>Results</th>
                </tr>
              </thead>
              <tbody>
                {topSearches.map((s, i) => (
                  <tr key={s.term}>
                    <td className="admin-cell-muted">{i + 1}</td>
                    <td className="admin-cell-name">{s.term}</td>
                    <td>{s.count}</td>
                    <td style={{ color: s.trend.startsWith('+') ? '#4caf50' : '#f44336', fontWeight: 600 }}>{s.trend}</td>
                    <td className="admin-cell-muted">{s.results}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Zero Results */}
        <div className="admin-detail-card">
          <h3>Zero Result Searches</h3>
          <p style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>Queries users searched but found nothing</p>
          <div className="admin-table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="admin-table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>Term</th>
                  <th>Count</th>
                  <th>Last Searched</th>
                </tr>
              </thead>
              <tbody>
                {zeroResults.map(s => (
                  <tr key={s.term}>
                    <td className="admin-cell-name">{s.term}</td>
                    <td>{s.count}</td>
                    <td className="admin-cell-muted">{s.lastSearched}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="admin-detail-grid" style={{ marginTop: 16 }}>
        {/* Search by Time */}
        <div className="admin-detail-card">
          <h3>Search Volume by Time</h3>
          <div style={{ marginTop: 12 }}>
            {searchByTime.map(s => (
              <div key={s.hour} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#888', width: 70, flexShrink: 0 }}>{s.hour}</span>
                <div style={{ flex: 1, height: 18, background: 'rgba(128,128,128,0.06)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${s.pct}%`, height: '100%', background: '#4caf50', borderRadius: 4, transition: 'width 0.3s' }} />
                </div>
                <span style={{ fontSize: 11, color: '#666', width: 50, textAlign: 'right' }}>{s.searches}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Searches */}
        <div className="admin-detail-card">
          <h3>Recent Searches</h3>
          <div className="admin-table-wrap" style={{ border: 'none', borderRadius: 0, marginTop: 8 }}>
            <table className="admin-table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Query</th>
                  <th>When</th>
                  <th>Clicked</th>
                </tr>
              </thead>
              <tbody>
                {recentSearches.map((s, i) => (
                  <tr key={i}>
                    <td className="admin-cell-name">{s.user}</td>
                    <td>{s.term}</td>
                    <td className="admin-cell-muted">{s.time}</td>
                    <td>
                      {s.clicked ? (
                        <span style={{ color: '#4caf50', fontSize: 11, fontWeight: 600 }}>Yes</span>
                      ) : (
                        <span style={{ color: '#ccc', fontSize: 11 }}>No</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
