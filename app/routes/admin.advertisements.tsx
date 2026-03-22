import { useState } from 'react';
import { useSortableTable, SortableTh } from '~/components/SortableTable';

type Tab = 'ads' | 'campaigns' | 'brands' | 'audiences';

const adsData = [
  { name: 'Summer Sale Banner', type: 'Banner', placement: 'Grid Top', status: 'active', impressions: '12,450', clicks: '342', ctr: '2.7%', spend: '$1,200' },
  { name: 'New Arrivals Splash', type: 'Interstitial', placement: 'App Open', status: 'active', impressions: '8,200', clicks: '615', ctr: '7.5%', spend: '$890' },
  { name: 'Creator Spotlight', type: 'Native', placement: 'Feed', status: 'paused', impressions: '5,100', clicks: '178', ctr: '3.5%', spend: '$450' },
  { name: 'Holiday Collection', type: 'Banner', placement: 'Search', status: 'scheduled', impressions: '0', clicks: '0', ctr: '-', spend: '$0' },
  { name: 'Brand Partner Feature', type: 'Native', placement: 'Creator Page', status: 'active', impressions: '3,800', clicks: '256', ctr: '6.7%', spend: '$720' },
];

const campaignsData = [
  { name: 'Spring Launch 2026', status: 'active', startDate: 'Mar 01, 2026', endDate: 'Apr 15, 2026', budget: '$5,000', spent: '$2,340', ads: 3, reach: '45.2K' },
  { name: 'Creator Onboarding Push', status: 'active', startDate: 'Feb 15, 2026', endDate: 'Mar 31, 2026', budget: '$3,000', spent: '$1,890', ads: 2, reach: '28.1K' },
  { name: 'Holiday 2025 Retarget', status: 'completed', startDate: 'Dec 01, 2025', endDate: 'Jan 15, 2026', budget: '$8,000', spent: '$7,650', ads: 5, reach: '92.4K' },
  { name: 'Valentines Lookbook', status: 'completed', startDate: 'Feb 01, 2026', endDate: 'Feb 14, 2026', budget: '$2,000', spent: '$2,000', ads: 2, reach: '31.7K' },
];

const brandsData = [
  { name: 'Aritzia', products: 8, looks: 14, clicks: '2,847', revenue: '$42,300', status: 'active' },
  { name: 'Zara', products: 12, looks: 9, clicks: '3,102', revenue: '$38,750', status: 'active' },
  { name: 'COS', products: 6, looks: 7, clicks: '1,456', revenue: '$21,200', status: 'active' },
  { name: 'Massimo Dutti', products: 5, looks: 4, clicks: '892', revenue: '$15,400', status: 'active' },
  { name: 'Everlane', products: 9, looks: 11, clicks: '2,203', revenue: '$31,800', status: 'active' },
  { name: 'Reformation', products: 4, looks: 6, clicks: '1,678', revenue: '$28,900', status: 'paused' },
];

const audiencesData = [
  { name: 'Fashion Forward Women 18-34', size: '12,400', source: 'Behavioral', status: 'active', lastUpdated: 'Mar 20, 2026', matchRate: '87%' },
  { name: 'Menswear Enthusiasts', size: '8,200', source: 'Interest', status: 'active', lastUpdated: 'Mar 18, 2026', matchRate: '92%' },
  { name: 'High-Value Shoppers', size: '3,100', source: 'Purchase', status: 'active', lastUpdated: 'Mar 15, 2026', matchRate: '95%' },
  { name: 'Creator Followers Lookalike', size: '25,600', source: 'Lookalike', status: 'building', lastUpdated: 'Mar 19, 2026', matchRate: '78%' },
  { name: 'Lapsed Users 30d', size: '4,800', source: 'Behavioral', status: 'active', lastUpdated: 'Mar 21, 2026', matchRate: '84%' },
];

export default function AdminAdvertisements() {
  const [activeTab, setActiveTab] = useState<Tab>('ads');
  const adsTable = useSortableTable(adsData);
  const campaignsTable = useSortableTable(campaignsData);
  const audiencesTable = useSortableTable(audiencesData);

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Advertisements</h1>
        <p className="admin-page-subtitle">Manage ads, campaigns, brands, and audiences</p>
      </div>
      <div className="admin-tabs">
        <button className={`admin-tab ${activeTab === 'ads' ? 'active' : ''}`} onClick={() => setActiveTab('ads')}>Ads</button>
        <button className={`admin-tab ${activeTab === 'campaigns' ? 'active' : ''}`} onClick={() => setActiveTab('campaigns')}>Campaigns</button>
        <button className={`admin-tab ${activeTab === 'brands' ? 'active' : ''}`} onClick={() => setActiveTab('brands')}>Brands</button>
        <button className={`admin-tab ${activeTab === 'audiences' ? 'active' : ''}`} onClick={() => setActiveTab('audiences')}>Audiences</button>
      </div>

      {activeTab === 'ads' && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <SortableTh label="Ad Name" sortKey="name" currentSort={adsTable.sort} onSort={adsTable.handleSort} />
                <SortableTh label="Type" sortKey="type" currentSort={adsTable.sort} onSort={adsTable.handleSort} />
                <SortableTh label="Placement" sortKey="placement" currentSort={adsTable.sort} onSort={adsTable.handleSort} />
                <th>Status</th>
                <SortableTh label="Impressions" sortKey="impressions" currentSort={adsTable.sort} onSort={adsTable.handleSort} />
                <SortableTh label="Clicks" sortKey="clicks" currentSort={adsTable.sort} onSort={adsTable.handleSort} />
                <th>CTR</th>
                <SortableTh label="Spend" sortKey="spend" currentSort={adsTable.sort} onSort={adsTable.handleSort} />
              </tr>
            </thead>
            <tbody>
              {adsTable.sortedData.map(a => (
                <tr key={a.name}>
                  <td className="admin-cell-name">{a.name}</td>
                  <td><span className="admin-sso-badge">{a.type}</span></td>
                  <td className="admin-cell-muted">{a.placement}</td>
                  <td><span className={`admin-status admin-status-${a.status === 'active' ? 'online' : a.status === 'paused' ? 'away' : 'offline'}`}>{a.status}</span></td>
                  <td>{a.impressions}</td>
                  <td>{a.clicks}</td>
                  <td>{a.ctr}</td>
                  <td style={{ fontWeight: 600 }}>{a.spend}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'campaigns' && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <SortableTh label="Campaign" sortKey="name" currentSort={campaignsTable.sort} onSort={campaignsTable.handleSort} />
                <th>Status</th>
                <SortableTh label="Start" sortKey="startDate" currentSort={campaignsTable.sort} onSort={campaignsTable.handleSort} />
                <SortableTh label="End" sortKey="endDate" currentSort={campaignsTable.sort} onSort={campaignsTable.handleSort} />
                <SortableTh label="Budget" sortKey="budget" currentSort={campaignsTable.sort} onSort={campaignsTable.handleSort} />
                <SortableTh label="Spent" sortKey="spent" currentSort={campaignsTable.sort} onSort={campaignsTable.handleSort} />
                <th>Ads</th>
                <SortableTh label="Reach" sortKey="reach" currentSort={campaignsTable.sort} onSort={campaignsTable.handleSort} />
              </tr>
            </thead>
            <tbody>
              {campaignsTable.sortedData.map(c => (
                <tr key={c.name}>
                  <td className="admin-cell-name">{c.name}</td>
                  <td><span className={`admin-status admin-status-${c.status === 'active' ? 'online' : c.status === 'completed' ? 'away' : 'offline'}`}>{c.status}</span></td>
                  <td className="admin-cell-muted">{c.startDate}</td>
                  <td className="admin-cell-muted">{c.endDate}</td>
                  <td style={{ fontWeight: 600 }}>{c.budget}</td>
                  <td>{c.spent}</td>
                  <td>{c.ads}</td>
                  <td>{c.reach}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'brands' && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Brand</th>
                <th>Products</th>
                <th>In Looks</th>
                <th>Link Clicks</th>
                <th>Revenue</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {brandsData.map(b => (
                <tr key={b.name}>
                  <td className="admin-cell-name">{b.name}</td>
                  <td>{b.products}</td>
                  <td>{b.looks}</td>
                  <td>{b.clicks}</td>
                  <td>{b.revenue}</td>
                  <td><span className={`admin-status admin-status-${b.status === 'active' ? 'online' : 'away'}`}>{b.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'audiences' && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <SortableTh label="Audience" sortKey="name" currentSort={audiencesTable.sort} onSort={audiencesTable.handleSort} />
                <SortableTh label="Size" sortKey="size" currentSort={audiencesTable.sort} onSort={audiencesTable.handleSort} />
                <SortableTh label="Source" sortKey="source" currentSort={audiencesTable.sort} onSort={audiencesTable.handleSort} />
                <th>Status</th>
                <SortableTh label="Updated" sortKey="lastUpdated" currentSort={audiencesTable.sort} onSort={audiencesTable.handleSort} />
                <th>Match Rate</th>
              </tr>
            </thead>
            <tbody>
              {audiencesTable.sortedData.map(a => (
                <tr key={a.name}>
                  <td className="admin-cell-name">{a.name}</td>
                  <td>{a.size}</td>
                  <td><span className="admin-sso-badge">{a.source}</span></td>
                  <td><span className={`admin-status admin-status-${a.status === 'active' ? 'online' : 'away'}`}>{a.status}</span></td>
                  <td className="admin-cell-muted">{a.lastUpdated}</td>
                  <td>{a.matchRate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
