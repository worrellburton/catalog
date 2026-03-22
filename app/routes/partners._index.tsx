import { useState, useRef, useEffect } from 'react';
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

const timeRanges = [
  { key: '7d', label: 'Last 7 days', short: '7D' },
  { key: '30d', label: 'Last 30 days', short: '30D' },
  { key: '90d', label: 'Last 90 days', short: '90D' },
  { key: '6m', label: 'Last 6 months', short: '6M' },
  { key: '1y', label: 'Last year', short: '1Y' },
  { key: 'all', label: 'All time', short: 'All' },
];

function getDateRangeLabel(key: string) {
  const now = new Date();
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (key === 'all') return 'All time';
  const days: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, '6m': 180, '1y': 365 };
  const d = days[key] || 30;
  const start = new Date(now.getTime() - d * 86400000);
  return `${fmt(start)} – ${fmt(now)}`;
}

export default function PartnersHome() {
  const [timeFilter, setTimeFilter] = useState('all');
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const sampleLooks = looks.slice(0, 2);

  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pickerOpen]);

  return (
    <div className="partners-page">
      <div className="partners-insights-header">
        <h2 className="partners-page-title" style={{ margin: 0 }}>Insights</h2>
        <div className="partners-time-bar">
          <div className="partners-time-pills">
            {timeRanges.map(t => (
              <button
                key={t.key}
                className={`partners-time-pill ${timeFilter === t.key ? 'active' : ''}`}
                onClick={() => setTimeFilter(t.key)}
              >
                {t.short}
              </button>
            ))}
          </div>
          <div className="partners-date-picker-wrap" ref={pickerRef}>
            <button className="partners-date-picker-btn" onClick={() => setPickerOpen(o => !o)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <span>{getDateRangeLabel(timeFilter)}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            {pickerOpen && (
              <div className="partners-date-dropdown">
                {timeRanges.map(t => (
                  <button
                    key={t.key}
                    className={`partners-date-dropdown-item ${timeFilter === t.key ? 'active' : ''}`}
                    onClick={() => { setTimeFilter(t.key); setPickerOpen(false); }}
                  >
                    <span>{t.label}</span>
                    {timeFilter === t.key && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="partners-view-toggle">
        <button className="partners-view-btn active" title="Overview">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        </button>
        <button className="partners-view-btn" title="Revenue">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </button>
        <button className="partners-view-btn" title="Growth">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 6l-9.5 9.5-5-5L1 18"/><polyline points="17 6 23 6 23 12"/></svg>
        </button>
        <button className="partners-view-btn" title="Audience">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </button>
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
