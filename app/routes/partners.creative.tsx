import { useState } from 'react';
import { useSortableTable, SortableTh } from '~/components/SortableTable';

const ads = [
  { name: 'Grid 1', type: 'Grid', placement: 'Feed', impressions: 168, clicks: 54, ctr: '32.14%', spend: '$0.00', status: 'Active', thumb: 'G1' },
  { name: 'Story 1', type: 'Story', placement: 'Explore', impressions: 1420, clicks: 135, ctr: '9.51%', spend: '$120.00', status: 'Active', thumb: 'S1' },
  { name: 'Banner 2', type: 'Banner', placement: 'Search', impressions: 0, clicks: 0, ctr: '0.00%', spend: '$0.00', status: 'Draft', thumb: 'B2' },
  { name: 'Carousel 1', type: 'Carousel', placement: 'Feed', impressions: 890, clicks: 67, ctr: '7.53%', spend: '$45.00', status: 'Paused', thumb: 'C1' },
];

export default function PartnersCreative() {
  const [view, setView] = useState<'list' | 'grid'>('list');
  const table = useSortableTable(ads);

  return (
    <div className="partners-page">
      <div className="partners-page-header">
        <h2 className="partners-page-title">Creative</h2>
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
            Upload Creative
          </button>
        </div>
      </div>

      <div className="partners-stats-row" style={{ marginBottom: 24 }}>
        <div className="partners-stat-card">
          <span className="partners-stat-label">Active Creative</span>
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

      {view === 'list' ? (
        <div className="partners-campaigns-table-wrap">
          <table className="partners-campaigns-table">
            <thead>
              <tr>
                <SortableTh label="Name" sortKey="name" currentSort={table.sort} onSort={table.handleSort} />
                <SortableTh label="Type" sortKey="type" currentSort={table.sort} onSort={table.handleSort} />
                <SortableTh label="Placement" sortKey="placement" currentSort={table.sort} onSort={table.handleSort} />
                <SortableTh label="Impressions" sortKey="impressions" currentSort={table.sort} onSort={table.handleSort} />
                <SortableTh label="Clicks" sortKey="clicks" currentSort={table.sort} onSort={table.handleSort} />
                <SortableTh label="CTR" sortKey="ctr" currentSort={table.sort} onSort={table.handleSort} />
                <SortableTh label="Spend" sortKey="spend" currentSort={table.sort} onSort={table.handleSort} />
                <SortableTh label="Status" sortKey="status" currentSort={table.sort} onSort={table.handleSort} />
              </tr>
            </thead>
            <tbody>
              {table.sortedData.map((ad, i) => (
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
      ) : (
        <div className="partners-grid-view">
          {ads.map((ad, i) => (
            <div key={i} className="partners-grid-card">
              <div className="partners-grid-card-preview partners-shimmer">
                <span className="partners-grid-card-label">{ad.thumb}</span>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#bbb" strokeWidth="1.2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              </div>
              <div className="partners-grid-card-body">
                <div className="partners-grid-card-title">{ad.name}</div>
                <div className="partners-grid-card-meta">{ad.type} · {ad.placement}</div>
                <div className="partners-grid-card-stats">
                  <span>{ad.impressions.toLocaleString()} impr</span>
                  <span>{ad.clicks} clicks</span>
                </div>
                <div className="partners-grid-card-footer">
                  <span className={`partners-status-badge ${ad.status.toLowerCase()}`}>{ad.status}</span>
                  <span style={{ fontWeight: 600, fontSize: 12 }}>{ad.spend}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
