const demographics = [
  { label: 'Women 18-24', pct: 32 },
  { label: 'Women 25-34', pct: 28 },
  { label: 'Men 18-24', pct: 18 },
  { label: 'Men 25-34', pct: 12 },
  { label: 'Other', pct: 10 },
];

const topLocations = [
  { city: 'New York', country: 'US', users: 89 },
  { city: 'Los Angeles', country: 'US', users: 67 },
  { city: 'London', country: 'UK', users: 45 },
  { city: 'Toronto', country: 'CA', users: 34 },
  { city: 'Miami', country: 'US', users: 28 },
  { city: 'Chicago', country: 'US', users: 22 },
  { city: 'Paris', country: 'FR', users: 19 },
  { city: 'Sydney', country: 'AU', users: 14 },
];

const interests = [
  { name: 'Fashion', score: 94 },
  { name: 'Streetwear', score: 87 },
  { name: 'Sustainability', score: 72 },
  { name: 'Travel', score: 65 },
  { name: 'Fitness', score: 58 },
  { name: 'Photography', score: 45 },
];

export default function PartnersAudience() {
  return (
    <div className="partners-page">
      <h2 className="partners-page-title">Audience</h2>

      <div className="partners-stats-row" style={{ marginBottom: 24 }}>
        <div className="partners-stat-card">
          <span className="partners-stat-label">Total Reach</span>
          <span className="partners-stat-value">1,248</span>
          <span className="partners-stat-change">+12% this month</span>
        </div>
        <div className="partners-stat-card">
          <span className="partners-stat-label">Engaged Users</span>
          <span className="partners-stat-value">342</span>
          <span className="partners-stat-change">+8% this month</span>
        </div>
        <div className="partners-stat-card">
          <span className="partners-stat-label">Returning</span>
          <span className="partners-stat-value">27%</span>
          <span className="partners-stat-change">+3% vs last month</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="partners-section-card">
          <h3 className="partners-section-title" style={{ textAlign: 'left', marginBottom: 16 }}>Demographics</h3>
          <div className="partners-demo-bars">
            {demographics.map((d, i) => (
              <div key={i} className="partners-demo-row">
                <span className="partners-demo-label">{d.label}</span>
                <div className="partners-demo-bar-wrap">
                  <div className="partners-demo-bar" style={{ width: `${d.pct}%` }} />
                </div>
                <span className="partners-demo-pct">{d.pct}%</span>
              </div>
            ))}
          </div>
        </div>

        <div className="partners-section-card">
          <h3 className="partners-section-title" style={{ textAlign: 'left', marginBottom: 16 }}>Interests</h3>
          <div className="partners-demo-bars">
            {interests.map((int, i) => (
              <div key={i} className="partners-demo-row">
                <span className="partners-demo-label">{int.name}</span>
                <div className="partners-demo-bar-wrap">
                  <div className="partners-demo-bar interest" style={{ width: `${int.score}%` }} />
                </div>
                <span className="partners-demo-pct">{int.score}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="partners-section-card">
        <h3 className="partners-section-title" style={{ textAlign: 'left', marginBottom: 16 }}>Top Locations</h3>
        <table className="partners-campaigns-table">
          <thead>
            <tr>
              <th>City</th>
              <th>Country</th>
              <th>Users</th>
            </tr>
          </thead>
          <tbody>
            {topLocations.map((loc, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 500 }}>{loc.city}</td>
                <td>{loc.country}</td>
                <td>{loc.users}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
