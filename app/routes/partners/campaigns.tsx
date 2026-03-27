import { useState } from 'react';
import { useSortableTable, SortableTh } from '~/components/SortableTable';

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

const availableCreative = [
  { id: 'grid-1', name: 'Grid 1', type: 'Grid', placement: 'Feed' },
  { id: 'story-1', name: 'Story 1', type: 'Story', placement: 'Explore' },
  { id: 'banner-2', name: 'Banner 2', type: 'Banner', placement: 'Search' },
  { id: 'carousel-1', name: 'Carousel 1', type: 'Carousel', placement: 'Feed' },
];

const availableAudiences = [
  { id: 'all', name: 'All Users', size: '1,248' },
  { id: 'women-18-34', name: 'Women 18-34', size: '748' },
  { id: 'high-intent', name: 'High Intent', size: '342' },
  { id: 'cart-abandoners', name: 'Cart Abandoners', size: '89' },
  { id: 'past-purchasers', name: 'Past Purchasers', size: '156' },
];

type CreateStep = 'closed' | 'creative' | 'audience' | 'details';

export default function PartnersCampaigns() {
  const [view, setView] = useState<'list' | 'grid'>('list');
  const table = useSortableTable(campaignData);
  const [createStep, setCreateStep] = useState<CreateStep>('closed');
  const [selectedCreative, setSelectedCreative] = useState<string | null>(null);
  const [selectedAudience, setSelectedAudience] = useState<string | null>(null);
  const [campaignName, setCampaignName] = useState('');

  const totalRevenue = '$245.00';
  const totalAdSpend = '$120.00';
  const totalCpc = '$0.89';

  const handleStartCreate = () => {
    setCreateStep('creative');
    setSelectedCreative(null);
    setSelectedAudience(null);
    setCampaignName('');
  };

  const handleCreate = () => {
    setCreateStep('closed');
  };

  const stepNumber = createStep === 'creative' ? 1 : createStep === 'audience' ? 2 : createStep === 'details' ? 3 : 0;

  return (
    <div className="partners-page">
      <div className="partners-page-header">
        <h2 className="partners-page-title">Campaigns</h2>
        <div className="partners-header-actions">
          <div className="partners-view-toggle">
            <button className={`partners-view-btn ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')} title="List view">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </button>
            <button className={`partners-view-btn ${view === 'grid' ? 'active' : ''}`} onClick={() => setView('grid')} title="Grid view">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            </button>
          </div>
          <button className="partners-create-campaign-btn" onClick={handleStartCreate}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Campaign
          </button>
        </div>
      </div>

      {/* Campaign creation flow */}
      {createStep !== 'closed' && (
        <div className="partners-create-flow">
          <div className="partners-create-flow-header">
            <div className="partners-create-flow-steps">
              <div className={`partners-flow-step ${stepNumber >= 1 ? 'active' : ''} ${stepNumber > 1 ? 'done' : ''}`}>
                <span className="partners-flow-step-num">1</span>
                <span>Select Creative</span>
              </div>
              <div className="partners-flow-step-line" />
              <div className={`partners-flow-step ${stepNumber >= 2 ? 'active' : ''} ${stepNumber > 2 ? 'done' : ''}`}>
                <span className="partners-flow-step-num">2</span>
                <span>Select Audience</span>
              </div>
              <div className="partners-flow-step-line" />
              <div className={`partners-flow-step ${stepNumber >= 3 ? 'active' : ''}`}>
                <span className="partners-flow-step-num">3</span>
                <span>Campaign Details</span>
              </div>
            </div>
            <button className="partners-flow-close" onClick={() => setCreateStep('closed')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          {createStep === 'creative' && (
            <div className="partners-flow-body">
              <h3 className="partners-flow-title">Select Creative</h3>
              <p className="partners-flow-desc">Choose which creative asset to use for this campaign</p>
              <div className="partners-flow-grid">
                {availableCreative.map(c => (
                  <button
                    key={c.id}
                    className={`partners-flow-card ${selectedCreative === c.id ? 'selected' : ''}`}
                    onClick={() => setSelectedCreative(c.id)}
                  >
                    <div className="partners-flow-card-preview partners-shimmer">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    </div>
                    <div className="partners-flow-card-info">
                      <span className="partners-flow-card-name">{c.name}</span>
                      <span className="partners-flow-card-meta">{c.type} · {c.placement}</span>
                    </div>
                    {selectedCreative === c.id && (
                      <div className="partners-flow-check">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      </div>
                    )}
                  </button>
                ))}
              </div>
              <div className="partners-flow-actions">
                <button className="partners-flow-btn secondary" onClick={() => setCreateStep('closed')}>Cancel</button>
                <button className="partners-flow-btn primary" disabled={!selectedCreative} onClick={() => setCreateStep('audience')}>
                  Next
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                </button>
              </div>
            </div>
          )}

          {createStep === 'audience' && (
            <div className="partners-flow-body">
              <h3 className="partners-flow-title">Select Audience</h3>
              <p className="partners-flow-desc">Choose which audience segment to target</p>
              <div className="partners-flow-grid">
                {availableAudiences.map(a => (
                  <button
                    key={a.id}
                    className={`partners-flow-card ${selectedAudience === a.id ? 'selected' : ''}`}
                    onClick={() => setSelectedAudience(a.id)}
                  >
                    <div className="partners-flow-card-preview" style={{ background: 'linear-gradient(135deg, #e0e7ff 0%, #f0e6ff 100%)' }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                    </div>
                    <div className="partners-flow-card-info">
                      <span className="partners-flow-card-name">{a.name}</span>
                      <span className="partners-flow-card-meta">{a.size} users</span>
                    </div>
                    {selectedAudience === a.id && (
                      <div className="partners-flow-check">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      </div>
                    )}
                  </button>
                ))}
              </div>
              <div className="partners-flow-actions">
                <button className="partners-flow-btn secondary" onClick={() => setCreateStep('creative')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
                  Back
                </button>
                <button className="partners-flow-btn primary" disabled={!selectedAudience} onClick={() => setCreateStep('details')}>
                  Next
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                </button>
              </div>
            </div>
          )}

          {createStep === 'details' && (
            <div className="partners-flow-body">
              <h3 className="partners-flow-title">Campaign Details</h3>
              <p className="partners-flow-desc">Name your campaign and review your selections</p>
              <div className="partners-flow-summary">
                <div className="partners-flow-summary-row">
                  <span className="partners-flow-summary-label">Creative</span>
                  <span className="partners-flow-summary-value">{availableCreative.find(c => c.id === selectedCreative)?.name}</span>
                </div>
                <div className="partners-flow-summary-row">
                  <span className="partners-flow-summary-label">Audience</span>
                  <span className="partners-flow-summary-value">{availableAudiences.find(a => a.id === selectedAudience)?.name}</span>
                </div>
              </div>
              <div className="partners-flow-field">
                <label className="partners-flow-field-label">Campaign Name</label>
                <input
                  type="text"
                  className="partners-flow-input"
                  placeholder="e.g. Spring Collection Launch"
                  value={campaignName}
                  onChange={e => setCampaignName(e.target.value)}
                />
              </div>
              <div className="partners-flow-actions">
                <button className="partners-flow-btn secondary" onClick={() => setCreateStep('audience')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
                  Back
                </button>
                <button className="partners-flow-btn primary" disabled={!campaignName.trim()} onClick={handleCreate}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  Create Campaign
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {view === 'list' ? (
        <div className="partners-campaigns-table-wrap">
          <table className="partners-campaigns-table">
            <thead>
              <tr>
                <SortableTh label="Campaign" sortKey="name" currentSort={table.sort} onSort={table.handleSort} />
                <SortableTh label="Creative" sortKey="advertisement" currentSort={table.sort} onSort={table.handleSort} />
                <SortableTh label="Audience" sortKey="audience" currentSort={table.sort} onSort={table.handleSort} />
                <SortableTh label="Revenue" sortKey="revenue" currentSort={table.sort} onSort={table.handleSort} />
                <SortableTh label="Ad Spend" sortKey="adSpend" currentSort={table.sort} onSort={table.handleSort} />
                <SortableTh label="CPC" sortKey="cpc" currentSort={table.sort} onSort={table.handleSort} />
                <th className="partners-th-accent">I</th>
                <th className="partners-th-accent">C</th>
                <th className="partners-th-green">CTR</th>
                <SortableTh label="ROAS" sortKey="roas" currentSort={table.sort} onSort={table.handleSort} />
                <SortableTh label="Status" sortKey="status" currentSort={table.sort} onSort={table.handleSort} />
              </tr>
            </thead>
            <tbody>
              {table.sortedData.map((c, i) => (
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
      ) : (
        <div className="partners-grid-view">
          {campaignData.map((c, i) => (
            <div key={i} className="partners-grid-card">
              <div className="partners-grid-card-preview" style={{ background: c.status === 'Live' ? 'linear-gradient(135deg, #dcfce7 0%, #d1fae5 100%)' : 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)' }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={c.status === 'Live' ? '#16a34a' : '#94a3b8'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
              </div>
              <div className="partners-grid-card-body">
                <div className="partners-grid-card-title">{c.name}</div>
                <div className="partners-grid-card-meta">{c.advertisement} · {c.audience}</div>
                <div className="partners-grid-card-stats">
                  <span>Rev: {c.revenue}</span>
                  <span>ROAS: {c.roas}x</span>
                </div>
                <div className="partners-grid-card-footer">
                  <span className={`partners-status-badge ${c.status.toLowerCase()}`}>{c.status}</span>
                  <span style={{ fontSize: 12, color: '#888' }}>{c.impressions.toLocaleString()} impr</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
