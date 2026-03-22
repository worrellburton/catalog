import { useState } from 'react';
import { useSortableTable, SortableTh } from '~/components/SortableTable';

const demographics = [
  { label: 'Women 18-24', pct: 32 },
  { label: 'Women 25-34', pct: 28 },
  { label: 'Men 18-24', pct: 18 },
  { label: 'Men 25-34', pct: 12 },
  { label: 'Other', pct: 10 },
];

const audiences = [
  { name: 'All Users', size: 1248, engagement: '27%', status: 'Active', description: 'All platform visitors' },
  { name: 'Women 18-34', size: 748, engagement: '34%', status: 'Active', description: 'Primary demo segment' },
  { name: 'High Intent', size: 342, engagement: '52%', status: 'Active', description: 'Users with 3+ visits' },
  { name: 'Cart Abandoners', size: 89, engagement: '18%', status: 'Active', description: 'Added to cart, no purchase' },
  { name: 'Past Purchasers', size: 156, engagement: '41%', status: 'Active', description: 'At least 1 order' },
  { name: 'Lookalike - Top Buyers', size: 0, engagement: '0%', status: 'Draft', description: 'Modeled from top 10%' },
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
  const [view, setView] = useState<'list' | 'grid'>('list');
  const locTable = useSortableTable(topLocations, { key: 'users', direction: 'desc' });
  const audTable = useSortableTable(audiences);

  return (
    <div className="partners-page">
      <div className="partners-page-header">
        <h2 className="partners-page-title">Audience</h2>
        <div className="partners-header-actions">
          <div className="partners-view-toggle">
            <button className={`partners-view-btn ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')} title="List view">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </button>
            <button className={`partners-view-btn ${view === 'grid' ? 'active' : ''}`} onClick={() => setView('grid')} title="Grid view">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            </button>
          </div>
          <button className="partners-create-campaign-btn" style={{ fontSize: 13, padding: '8px 16px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Audience
          </button>
        </div>
      </div>

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

      {/* Audience segments - list or grid */}
      <div className="partners-section-card" style={{ marginBottom: 16 }}>
        <h3 className="partners-section-title" style={{ textAlign: 'left', marginBottom: 16 }}>Audience Segments</h3>
        {view === 'list' ? (
          <table className="partners-campaigns-table">
            <thead>
              <tr>
                <SortableTh label="Audience" sortKey="name" currentSort={audTable.sort} onSort={audTable.handleSort} />
                <SortableTh label="Size" sortKey="size" currentSort={audTable.sort} onSort={audTable.handleSort} />
                <SortableTh label="Engagement" sortKey="engagement" currentSort={audTable.sort} onSort={audTable.handleSort} />
                <SortableTh label="Status" sortKey="status" currentSort={audTable.sort} onSort={audTable.handleSort} />
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {audTable.sortedData.map((a, i) => (
                <tr key={i}>
                  <td>
                    <div className="partners-campaign-cell">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                      <span style={{ fontWeight: 500 }}>{a.name}</span>
                    </div>
                  </td>
                  <td style={{ fontWeight: 600 }}>{a.size.toLocaleString()}</td>
                  <td><span className="partners-money-badge">{a.engagement}</span></td>
                  <td><span className={`partners-status-badge ${a.status.toLowerCase()}`}>{a.status}</span></td>
                  <td style={{ color: '#888', fontSize: 12 }}>{a.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="partners-grid-view">
            {audiences.map((a, i) => (
              <div key={i} className="partners-grid-card">
                <div className="partners-grid-card-preview" style={{ background: 'linear-gradient(135deg, #e0e7ff 0%, #f0e6ff 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                </div>
                <div className="partners-grid-card-body">
                  <div className="partners-grid-card-title">{a.name}</div>
                  <div className="partners-grid-card-meta">{a.description}</div>
                  <div className="partners-grid-card-stats">
                    <span>{a.size.toLocaleString()} users</span>
                    <span>{a.engagement} engaged</span>
                  </div>
                  <div className="partners-grid-card-footer">
                    <span className={`partners-status-badge ${a.status.toLowerCase()}`}>{a.status}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
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
              <SortableTh label="City" sortKey="city" currentSort={locTable.sort} onSort={locTable.handleSort} />
              <SortableTh label="Country" sortKey="country" currentSort={locTable.sort} onSort={locTable.handleSort} />
              <SortableTh label="Users" sortKey="users" currentSort={locTable.sort} onSort={locTable.handleSort} />
            </tr>
          </thead>
          <tbody>
            {locTable.sortedData.map((loc, i) => (
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
