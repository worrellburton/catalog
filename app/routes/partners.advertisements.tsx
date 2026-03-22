const ads = [
  { name: 'Grid 1', type: 'Grid', placement: 'Feed', impressions: 168, clicks: 54, ctr: '32.14%', spend: '$0.00', status: 'Active' },
  { name: 'Story 1', type: 'Story', placement: 'Explore', impressions: 1420, clicks: 135, ctr: '9.51%', spend: '$120.00', status: 'Active' },
  { name: 'Banner 2', type: 'Banner', placement: 'Search', impressions: 0, clicks: 0, ctr: '0.00%', spend: '$0.00', status: 'Draft' },
  { name: 'Carousel 1', type: 'Carousel', placement: 'Feed', impressions: 890, clicks: 67, ctr: '7.53%', spend: '$45.00', status: 'Paused' },
];

export default function PartnersAdvertisements() {
  return (
    <div className="partners-page">
      <div className="partners-page-header">
        <h2 className="partners-page-title">Advertisements</h2>
        <button className="partners-create-campaign-btn" style={{ fontSize: 13, padding: '8px 16px' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Create Ad
        </button>
      </div>

      <div className="partners-stats-row" style={{ marginBottom: 24 }}>
        <div className="partners-stat-card">
          <span className="partners-stat-label">Active Ads</span>
          <span className="partners-stat-value">2</span>
        </div>
        <div className="partners-stat-card">
          <span className="partners-stat-label">Total Impressions</span>
          <span className="partners-stat-value">2,478</span>
        </div>
        <div className="partners-stat-card">
          <span className="partners-stat-label">Total Spend</span>
          <span className="partners-stat-value">$165</span>
        </div>
      </div>

      <div className="partners-campaigns-table-wrap">
        <table className="partners-campaigns-table">
          <thead>
            <tr>
              <th>Ad Name</th>
              <th>Type</th>
              <th>Placement</th>
              <th>Impressions</th>
              <th>Clicks</th>
              <th>CTR</th>
              <th>Spend</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {ads.map((ad, i) => (
              <tr key={i}>
                <td>
                  <div className="partners-campaign-cell">
                    <div className="partners-ad-thumb partners-shimmer">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    </div>
                    <span style={{ fontWeight: 500 }}>{ad.name}</span>
                  </div>
                </td>
                <td>{ad.type}</td>
                <td>{ad.placement}</td>
                <td>{ad.impressions.toLocaleString()}</td>
                <td>{ad.clicks}</td>
                <td><span className="partners-money-badge">{ad.ctr}</span></td>
                <td style={{ fontWeight: 600 }}>{ad.spend}</td>
                <td>
                  <span className={`partners-status-badge ${ad.status.toLowerCase()}`}>{ad.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
