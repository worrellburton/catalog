import { useState } from 'react';
import { looks } from '~/data/looks';

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

export default function PartnersHome() {
  const [timeFilter, setTimeFilter] = useState('all');
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const sampleLooks = looks.slice(0, 2);

  return (
    <div className="partners-page">
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
            <div key={`ph-${i}`} className="partners-look-placeholder partners-shimmer">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
            <div key={i} className="partners-creator-placeholder partners-shimmer">
              <div className="partners-creator-avatar-ph" />
              <div className="partners-creator-lines">
                <div className="partners-line-ph" style={{ width: '60%' }} />
                <div className="partners-line-ph short" style={{ width: '40%' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
