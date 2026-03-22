import { useState, useRef, useEffect } from 'react';
import { looks } from '~/data/looks';

const statCards = [
  { label: 'Revenue', value: '$70', change: '+$0 yesterday', trend: [20, 35, 28, 42, 55, 48, 70] },
  { label: 'ROAS', value: '2x', change: '', highlight: true, trend: [1, 1.2, 1.5, 1.8, 2, 1.9, 2] },
  { label: 'Ad Spend', value: '$35', change: '+$0 yesterday', trend: [10, 15, 20, 25, 30, 32, 35] },
];

const statCards2 = [
  { label: 'Impressions', value: '22', change: '+1 yesterday', trend: [5, 8, 12, 15, 18, 20, 22] },
  { label: 'Clickouts', value: '16', change: '+0 yesterday', trend: [3, 5, 8, 10, 12, 14, 16] },
  { label: 'Orders', value: '2', change: '+0 yesterday', trend: [0, 0, 0, 1, 1, 1, 2] },
];

const timeRanges = [
  { key: '7d', label: 'Last 7 days', short: '7D' },
  { key: '30d', label: 'Last 30 days', short: '30D' },
  { key: '90d', label: 'Last 90 days', short: '90D' },
  { key: '6m', label: 'Last 6 months', short: '6M' },
  { key: '1y', label: 'Last year', short: '1Y' },
  { key: 'all', label: 'All time', short: 'All' },
];

const revenueByDay = [
  { day: 'Mon', value: 12 },
  { day: 'Tue', value: 8 },
  { day: 'Wed', value: 18 },
  { day: 'Thu', value: 15 },
  { day: 'Fri', value: 22 },
  { day: 'Sat', value: 10 },
  { day: 'Sun', value: 5 },
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

function MiniSparkline({ data, color = '#22c55e' }: { data: number[]; color?: string }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const h = 24;
  const w = 60;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="partners-mini-sparkline">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function PartnersHome() {
  const [timeFilter, setTimeFilter] = useState('all');
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const sampleLooks = looks.slice(0, 2);
  const maxRevenue = Math.max(...revenueByDay.map(d => d.value));

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

      <div className="partners-stats-row">
        {statCards.map(card => (
          <div key={card.label} className={`partners-stat-card ${card.highlight ? 'highlight' : ''}`}>
            <div className="partners-stat-top">
              <span className="partners-stat-label">{card.label}</span>
              <MiniSparkline data={card.trend} color={card.highlight ? '#a78bfa' : '#22c55e'} />
            </div>
            <span className="partners-stat-value">{card.value}</span>
            {card.change && <span className="partners-stat-change">{card.change}</span>}
          </div>
        ))}
      </div>

      <div className="partners-stats-row">
        {statCards2.map(card => (
          <div key={card.label} className="partners-stat-card">
            <div className="partners-stat-top">
              <span className="partners-stat-label">{card.label}</span>
              <MiniSparkline data={card.trend} />
            </div>
            <span className="partners-stat-value">{card.value}</span>
            <span className="partners-stat-change">{card.change}</span>
          </div>
        ))}
      </div>

      <div className="partners-dashboard-grid">
        <div className="partners-section-card">
          <h3 className="partners-section-title" style={{ textAlign: 'left', marginBottom: 16 }}>Revenue by Day</h3>
          <div className="partners-bar-chart">
            {revenueByDay.map((d, i) => (
              <div key={i} className="partners-bar-col">
                <div className="partners-bar" style={{ height: `${(d.value / maxRevenue) * 100}px` }}>
                  <span className="partners-bar-value">${d.value}</span>
                </div>
                <span className="partners-bar-label">{d.day}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="partners-section-card">
          <h3 className="partners-section-title" style={{ textAlign: 'left', marginBottom: 16 }}>Quick Actions</h3>
          <div className="partners-quick-actions">
            <button className="partners-quick-action">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              <span>New Campaign</span>
            </button>
            <button className="partners-quick-action">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
              <span>Add Product</span>
            </button>
            <button className="partners-quick-action">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              <span>Sync Products</span>
            </button>
            <button className="partners-quick-action">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span>Export Data</span>
            </button>
          </div>
        </div>
      </div>

      <div className="partners-section-card">
        <h3 className="partners-section-title" style={{ textAlign: 'left' }}>Looks posted with your brand will show up here</h3>
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
        <h3 className="partners-section-title" style={{ textAlign: 'left' }}>Creators that own your product will show up here</h3>
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
