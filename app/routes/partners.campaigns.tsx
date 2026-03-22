const campaignData = [
  {
    name: 'Test 1',
    advertisement: 'Grid 1',
    audience: 'All',
    revenue: '$0.00',
    adSpend: '$0.00',
    cpc: '$0.00',
    impressions: 168,
    clicks: 54,
    ctr: '32.14%',
    roas: 0,
    status: 'Live' as const,
  },
  {
    name: 'Summer Drop',
    advertisement: 'Story 1',
    audience: 'Women 18-34',
    revenue: '$245.00',
    adSpend: '$120.00',
    cpc: '$0.89',
    impressions: 1420,
    clicks: 135,
    ctr: '9.51%',
    roas: 2,
    status: 'Live' as const,
  },
  {
    name: 'Fall Preview',
    advertisement: 'Banner 2',
    audience: 'All',
    revenue: '$0.00',
    adSpend: '$0.00',
    cpc: '$0.00',
    impressions: 0,
    clicks: 0,
    ctr: '0.00%',
    roas: 0,
    status: 'Draft' as const,
  },
];

export default function PartnersCampaigns() {
  const totalRevenue = '$245.00';
  const totalAdSpend = '$120.00';
  const totalCpc = '$0.89';

  return (
    <div className="partners-page">
      <h2 className="partners-page-title">Campaigns</h2>
      <div className="partners-campaigns-table-wrap">
        <table className="partners-campaigns-table">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Advertisement</th>
              <th>Audience</th>
              <th>Revenue</th>
              <th>Ad Spend</th>
              <th>CPC</th>
              <th className="partners-th-accent">I</th>
              <th className="partners-th-accent">C</th>
              <th className="partners-th-green">CTR</th>
              <th>ROAS</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {campaignData.map((c, i) => (
              <tr key={i}>
                <td>
                  <div className="partners-campaign-cell">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12l2 2 4-4"/></svg>
                    <span>{c.name}</span>
                  </div>
                </td>
                <td>
                  <div className="partners-campaign-cell">
                    <div className="partners-ad-thumb">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18.01"/></svg>
                    </div>
                    <span>{c.advertisement}</span>
                  </div>
                </td>
                <td>
                  <div className="partners-campaign-cell">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                    <span>{c.audience}</span>
                  </div>
                </td>
                <td><span className="partners-money-badge">{c.revenue}</span></td>
                <td><span className="partners-money-badge">{c.adSpend}</span></td>
                <td><span className="partners-money-badge">{c.cpc}</span></td>
                <td colSpan={3}>
                  <div className="partners-ctr-calc">
                    <span className="partners-ctr-num">{c.impressions}</span>
                    <span className="partners-ctr-op">/</span>
                    <span className="partners-ctr-num">{c.clicks}</span>
                    <span className="partners-ctr-op">=</span>
                    <span className="partners-ctr-result">{c.ctr}</span>
                  </div>
                </td>
                <td>
                  <div className={`partners-roas-circle ${c.roas === 0 ? 'zero' : ''}`}>
                    {c.roas}
                  </div>
                </td>
                <td>
                  <span className={`partners-status-badge ${c.status.toLowerCase()}`}>
                    {c.status}
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                  </span>
                </td>
              </tr>
            ))}
            <tr className="partners-campaign-summary">
              <td colSpan={3}><span style={{ fontWeight: 600, color: '#999', fontSize: 12 }}>Totals</span></td>
              <td><span className="partners-money-badge green">{totalRevenue}</span></td>
              <td><span className="partners-money-badge green">{totalAdSpend}</span></td>
              <td><span className="partners-money-badge green">{totalCpc}</span></td>
              <td colSpan={3}>
                <div className="partners-ctr-calc summary">
                  <span className="partners-ctr-num">1588</span>
                  <span className="partners-ctr-op">/</span>
                  <span className="partners-ctr-num">189</span>
                  <span className="partners-ctr-op">=</span>
                  <span className="partners-ctr-result">11.90%</span>
                </div>
              </td>
              <td>
                <div className="partners-roas-circle orange">2</div>
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <div className="partners-create-campaign-wrap">
        <button className="partners-create-campaign-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Create Campaign
        </button>
      </div>
    </div>
  );
}
