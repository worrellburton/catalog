import { useState } from 'react';
import { looks } from '~/data/looks';

const navItems = [
  { label: 'Dashboard', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', group: 1 },
  { label: 'Orders', icon: 'M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0', group: 1 },
  { label: 'Store', icon: 'M3 3h18v18H3zM3 9h18M9 21V9', group: 2 },
  { label: 'Collections', icon: 'M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21', group: 2 },
  { label: 'Products', icon: 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01', group: 2 },
  { label: 'Growth', icon: 'M23 6l-9.5 9.5-5-5L1 18', group: 3 },
  { label: 'Campaigns', icon: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7', group: 3 },
  { label: 'Advertisements', icon: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z', group: 3 },
  { label: 'Audience', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75', group: 3 },
];

const statCards = [
  { label: 'Revenue', value: '$70', change: '+0 yesterday' },
  { label: 'ROAS', value: '2x', change: '', highlight: true },
  { label: 'Ad Spend', value: '$35', change: '+0 yesterday' },
];

const statCards2 = [
  { label: '# of Impressions', value: '22', change: '+1 yesterday' },
  { label: '# of Clickouts', value: '16', change: '+0 yesterday' },
  { label: '# of Orders', value: '2', change: '+0 yesterday' },
];

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
];

function PartnersSidebar({ activeNav, setActiveNav }: { activeNav: string; setActiveNav: (v: string) => void }) {
  let lastGroup = 0;
  return (
    <aside className="partners-sidebar">
      <div className="partners-sidebar-logo">Catalog</div>
      <nav className="partners-sidebar-nav">
        {navItems.map(item => {
          const showDivider = item.group !== lastGroup && lastGroup !== 0;
          lastGroup = item.group;
          return (
            <div key={item.label}>
              {showDivider && <div className="partners-nav-divider" />}
              <button
                className={`partners-nav-item ${activeNav === item.label ? 'active' : ''}`}
                onClick={() => setActiveNav(item.label)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d={item.icon} />
                </svg>
                <span>{item.label}</span>
              </button>
            </div>
          );
        })}
      </nav>
      <div className="partners-sidebar-footer">
        <button className="partners-shopify-btn">Go to Shopify</button>
        <button className="partners-sync-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          Sync
        </button>
        <div className="partners-user-profile">
          <div className="partners-user-avatar">A</div>
          <div className="partners-user-info">
            <span className="partners-user-name">Robert Burton</span>
            <span className="partners-user-org">Atlas</span>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>
    </aside>
  );
}

function DashboardView() {
  const [timeFilter, setTimeFilter] = useState('all');
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const sampleLooks = looks.slice(0, 2);

  return (
    <>
      <div className="partners-time-filter">
        <select value={timeFilter} onChange={e => setTimeFilter(e.target.value)} className="partners-time-select">
          <option value="all">All time</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </select>
      </div>

      <div className="partners-stats-row">
        {statCards.map(card => (
          <div key={card.label} className={`partners-stat-card ${card.highlight ? 'highlight' : ''}`}>
            <span className="partners-stat-label">{card.label}</span>
            <span className="partners-stat-value">{card.value}</span>
            {card.change && <span className="partners-stat-change">{card.change}</span>}
          </div>
        ))}
      </div>

      <div className="partners-stats-row">
        {statCards2.map(card => (
          <div key={card.label} className="partners-stat-card">
            <span className="partners-stat-label">{card.label}</span>
            <span className="partners-stat-value">{card.value}</span>
            <span className="partners-stat-change">{card.change}</span>
          </div>
        ))}
      </div>

      <div className="partners-section-card">
        <h3 className="partners-section-title">Looks posted with your brand will show up here</h3>
        <div className="partners-looks-grid">
          {sampleLooks.map(look => (
            <div key={look.id} className="partners-look-thumb">
              <video src={`${basePath}/${look.video}`} muted loop playsInline preload="metadata" />
            </div>
          ))}
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={`ph-${i}`} className="partners-look-placeholder">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v1H6a1 1 0 0 0-1 1v1h14V7a1 1 0 0 0-1-1h-3V5a3 3 0 0 0-3-3z" />
                <path d="M5 8l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12" />
              </svg>
            </div>
          ))}
        </div>
      </div>

      <div className="partners-section-card">
        <h3 className="partners-section-title">Creators that own your product will show up here</h3>
        <div className="partners-creators-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="partners-creator-placeholder">
              <div className="partners-creator-avatar-ph" />
              <div className="partners-creator-lines">
                <div className="partners-line-ph" style={{ width: '60%' }} />
                <div className="partners-line-ph short" style={{ width: '40%' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function CampaignsView() {
  return (
    <>
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
            {/* Summary row */}
            <tr className="partners-campaign-summary">
              <td colSpan={3} />
              <td><span className="partners-money-badge green">{campaignData[0].revenue}</span></td>
              <td><span className="partners-money-badge green">{campaignData[0].adSpend}</span></td>
              <td><span className="partners-money-badge green">{campaignData[0].cpc}</span></td>
              <td colSpan={3}>
                <div className="partners-ctr-calc summary">
                  <span className="partners-ctr-num">{campaignData[0].impressions}</span>
                  <span className="partners-ctr-op">/</span>
                  <span className="partners-ctr-num">{campaignData[0].clicks}</span>
                  <span className="partners-ctr-op">=</span>
                  <span className="partners-ctr-result">{campaignData[0].ctr}</span>
                </div>
              </td>
              <td>
                <div className="partners-roas-circle zero orange">0</div>
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
    </>
  );
}

function PlaceholderView({ title }: { title: string }) {
  return (
    <>
      <h2 className="partners-page-title">{title}</h2>
      <div className="partners-empty">No data yet</div>
    </>
  );
}

export default function Partners() {
  const [activeNav, setActiveNav] = useState('Dashboard');

  const renderView = () => {
    switch (activeNav) {
      case 'Dashboard': return <DashboardView />;
      case 'Campaigns': return <CampaignsView />;
      default: return <PlaceholderView title={activeNav} />;
    }
  };

  return (
    <div className="partners-layout">
      <PartnersSidebar activeNav={activeNav} setActiveNav={setActiveNav} />
      <main className="partners-main">
        {renderView()}
      </main>
    </div>
  );
}
