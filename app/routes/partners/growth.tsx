import { useSortableTable, SortableTh } from '~/components/SortableTable';

const weeklyData = [
  { week: 'Feb 17', views: 120, clicks: 18, orders: 1 },
  { week: 'Feb 24', views: 145, clicks: 22, orders: 2 },
  { week: 'Mar 3', views: 198, clicks: 31, orders: 3 },
  { week: 'Mar 10', views: 234, clicks: 42, orders: 4 },
  { week: 'Mar 17', views: 342, clicks: 54, orders: 8 },
];

const referralSources = [
  { source: 'Catalog App', visits: 245, conversion: '4.2%' },
  { source: 'Instagram', visits: 89, conversion: '2.1%' },
  { source: 'Direct', visits: 67, conversion: '5.8%' },
  { source: 'TikTok', visits: 42, conversion: '1.9%' },
  { source: 'Google', visits: 28, conversion: '3.4%' },
];

export default function PartnersGrowth() {
  const maxViews = Math.max(...weeklyData.map(d => d.views));
  const table = useSortableTable(referralSources, { key: 'visits', direction: 'desc' });

  return (
    <div className="partners-page">
      <h2 className="partners-page-title">Growth</h2>

      <div className="partners-stats-row" style={{ marginBottom: 24 }}>
        <div className="partners-stat-card">
          <span className="partners-stat-label">Total Views</span>
          <span className="partners-stat-value">1,039</span>
          <span className="partners-stat-change">+46% vs last month</span>
        </div>
        <div className="partners-stat-card highlight">
          <span className="partners-stat-label">Growth Rate</span>
          <span className="partners-stat-value">+46%</span>
        </div>
        <div className="partners-stat-card">
          <span className="partners-stat-label">New Customers</span>
          <span className="partners-stat-value">18</span>
          <span className="partners-stat-change">+8 this week</span>
        </div>
      </div>

      <div className="partners-section-card" style={{ marginBottom: 16 }}>
        <h3 className="partners-section-title" style={{ textAlign: 'left', marginBottom: 16 }}>Weekly Views</h3>
        <div className="partners-bar-chart">
          {weeklyData.map((d, i) => (
            <div key={i} className="partners-bar-col">
              <div className="partners-bar" style={{ height: `${(d.views / maxViews) * 140}px` }}>
                <span className="partners-bar-value">{d.views}</span>
              </div>
              <span className="partners-bar-label">{d.week}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="partners-section-card">
        <h3 className="partners-section-title" style={{ textAlign: 'left', marginBottom: 16 }}>Referral Sources</h3>
        <table className="partners-campaigns-table">
          <thead>
            <tr>
              <SortableTh label="Source" sortKey="source" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Visits" sortKey="visits" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Conversion" sortKey="conversion" currentSort={table.sort} onSort={table.handleSort} />
            </tr>
          </thead>
          <tbody>
            {table.sortedData.map((r, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 500 }}>{r.source}</td>
                <td>{r.visits}</td>
                <td><span className="partners-money-badge">{r.conversion}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
