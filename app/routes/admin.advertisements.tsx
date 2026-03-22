import { useState } from 'react';

type Tab = 'ads' | 'campaigns' | 'audiences' | 'signup-links' | 'brands';

const brands = [
  { name: 'Aritzia', products: 8, looks: 14, clicks: '2,847', revenue: '$42,300', status: 'active' },
  { name: 'Zara', products: 12, looks: 9, clicks: '3,102', revenue: '$38,750', status: 'active' },
  { name: 'COS', products: 6, looks: 7, clicks: '1,456', revenue: '$21,200', status: 'active' },
  { name: 'Massimo Dutti', products: 5, looks: 4, clicks: '892', revenue: '$15,400', status: 'active' },
  { name: 'Everlane', products: 9, looks: 11, clicks: '2,203', revenue: '$31,800', status: 'active' },
  { name: 'Reformation', products: 4, looks: 6, clicks: '1,678', revenue: '$28,900', status: 'paused' },
];

export default function AdminAdvertisements() {
  const [activeTab, setActiveTab] = useState<Tab>('ads');

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
        <button className={`admin-tab ${activeTab === 'signup-links' ? 'active' : ''}`} onClick={() => setActiveTab('signup-links')}>Signup Links</button>
      </div>

      {activeTab === 'ads' && (
        <div className="admin-empty">No advertisements yet</div>
      )}
      {activeTab === 'campaigns' && (
        <div className="admin-empty">No campaigns yet</div>
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
              {brands.map(b => (
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
        <div className="admin-empty">No audience segments yet</div>
      )}
      {activeTab === 'signup-links' && (
        <div className="admin-empty">No signup links yet</div>
      )}
    </div>
  );
}
