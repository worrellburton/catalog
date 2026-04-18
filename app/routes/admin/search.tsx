import { useState, useEffect, useRef, useCallback } from 'react';

// --- Simulated live data ---

const SEARCH_TERMS = [
  'summer dresses', 'dior sneakers', 'streetwear', 'white sneakers', 'casual outfits',
  'minimalist style', 'zara bag', 'linen pants', 'date night outfit', 'mens fashion',
  'crop top', 'oversized blazer', 'platform shoes', 'gold jewelry', 'vintage sunglasses',
  'silk skirt', 'chunky sneakers', 'leather jacket', 'boho dress', 'tennis bracelet',
  'y2k aesthetic', 'quiet luxury', 'mob wife aesthetic', 'coastal grandmother',
  'ballet flats', 'wide leg jeans', 'linen shirt men', 'crochet top', 'maxi skirt',
  'running shoes', 'tote bag', 'bucket hat', 'cargo pants', 'mesh top',
  'statement earrings', 'pleated skirt', 'trench coat', 'kitten heels',
  'prada loafers', 'gucci belt', 'ralph lauren polo', 'new balance 550',
  'adidas samba', 'birkenstock boston', 'nike dunk low', 'converse chuck 70',
];

const USERNAMES = [
  'Carla', 'alfvaz', 'franky90', 'D1.barbershop', 'lily.rose', 'jakethefit',
  'mia_styles', 'devonk', 'samira.xx', 'noahcollins', 'ava.trends', 'marcusg',
  'elena.p', 'bencarter', 'zoeyfit', 'ryankim', 'chloe.j', 'luisgarcia',
  'priya.m', 'tom.styles', 'natalierose', 'alexmoreno', 'isabellaw',
];

interface LiveEntry {
  id: number;
  timestamp: Date;
  term: string;
  user: string;
  resultCount: number;
  clickedThrough: boolean;
}

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
}

// --- Component ---

export default function AdminSearch() {
  const [activeTab, setActiveTab] = useState<'overview' | 'live' | 'trends'>('overview');

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Search</h1>
        <p className="admin-page-subtitle">Search analytics and discovery insights</p>
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>Overview</button>
        <button className={`admin-tab ${activeTab === 'live' ? 'active' : ''}`} onClick={() => setActiveTab('live')}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#22c55e',
              display: 'inline-block',
              animation: 'adminLivePulse 2s ease-in-out infinite',
            }} />
            Live Activity
          </span>
        </button>
        <button className={`admin-tab ${activeTab === 'trends' ? 'active' : ''}`} onClick={() => setActiveTab('trends')}>Trends</button>
      </div>

      {activeTab === 'overview' && <OverviewTab />}
      {activeTab === 'live' && <LiveActivityTab />}
      {activeTab === 'trends' && <TrendsTab />}

      <style>{`
        @keyframes adminLivePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.8); }
        }
      `}</style>
    </div>
  );
}

// ─── Overview Tab (original content) ───

function OverviewTab() {
  const topSearches = [
    { term: 'summer dresses', count: 342, trend: '+18%', results: 12 },
    { term: 'streetwear', count: 289, trend: '+5%', results: 8 },
    { term: 'dior sneakers', count: 234, trend: '+42%', results: 3 },
    { term: 'white sneakers', count: 198, trend: '-2%', results: 6 },
    { term: 'linen pants', count: 176, trend: '+12%', results: 4 },
    { term: 'casual outfits', count: 165, trend: '+8%', results: 15 },
    { term: 'minimalist style', count: 154, trend: '+22%', results: 9 },
    { term: 'mens fashion', count: 143, trend: '-5%', results: 7 },
    { term: 'zara bag', count: 132, trend: '+31%', results: 2 },
    { term: 'date night outfit', count: 121, trend: '+15%', results: 5 },
  ];

  const zeroResults = [
    { term: 'nike air max', count: 87, lastSearched: 'Mar 21, 2026' },
    { term: 'vintage denim', count: 64, lastSearched: 'Mar 20, 2026' },
    { term: 'louis vuitton', count: 52, lastSearched: 'Mar 21, 2026' },
    { term: 'corset top', count: 41, lastSearched: 'Mar 19, 2026' },
    { term: 'cargo pants wide', count: 38, lastSearched: 'Mar 18, 2026' },
  ];

  const searchByTime = [
    { hour: '12am-4am', searches: 120, pct: 3 },
    { hour: '4am-8am', searches: 340, pct: 8 },
    { hour: '8am-12pm', searches: 1250, pct: 28 },
    { hour: '12pm-4pm', searches: 980, pct: 22 },
    { hour: '4pm-8pm', searches: 1100, pct: 25 },
    { hour: '8pm-12am', searches: 610, pct: 14 },
  ];

  const recentSearches = [
    { user: 'Carla', term: 'summer dresses', time: '2 min ago', clicked: true },
    { user: 'alfvaz', term: 'dior sneakers', time: '5 min ago', clicked: true },
    { user: 'franky90', term: 'casual outfits', time: '8 min ago', clicked: false },
    { user: 'D1.barbershop', term: 'barber supplies', time: '12 min ago', clicked: false },
    { user: 'Carla', term: 'white sneakers', time: '15 min ago', clicked: true },
    { user: 'alfvaz', term: 'streetwear', time: '22 min ago', clicked: true },
    { user: 'franky90', term: 'jeans', time: '30 min ago', clicked: false },
    { user: 'Carla', term: 'linen pants', time: '45 min ago', clicked: true },
  ];

  const stats = [
    { label: 'Total Searches', value: '4,400' },
    { label: 'Unique Terms', value: '892' },
    { label: 'Avg. Results', value: '7.2' },
    { label: 'Click-through', value: '62%' },
    { label: 'Zero Results', value: '14%' },
    { label: 'Searches/User', value: '3.8' },
  ];

  return (
    <>
      <div className="admin-stats-grid">
        {stats.map(s => (
          <div key={s.label} className="admin-stat-card">
            <span className="admin-stat-value">{s.value}</span>
            <span className="admin-stat-label">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="admin-detail-grid" style={{ marginTop: 20 }}>
        {/* Top Searches */}
        <div className="admin-detail-card">
          <h3>Top Searches</h3>
          <div className="admin-table-wrap" style={{ border: 'none', borderRadius: 0, marginTop: 8 }}>
            <table className="admin-table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Term</th>
                  <th>Count</th>
                  <th>Trend</th>
                  <th>Results</th>
                </tr>
              </thead>
              <tbody>
                {topSearches.map((s, i) => (
                  <tr key={s.term}>
                    <td className="admin-cell-muted">{i + 1}</td>
                    <td className="admin-cell-name">{s.term}</td>
                    <td>{s.count}</td>
                    <td style={{ color: s.trend.startsWith('+') ? '#4caf50' : '#f44336', fontWeight: 600 }}>{s.trend}</td>
                    <td className="admin-cell-muted">{s.results}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Zero Results */}
        <div className="admin-detail-card">
          <h3>Zero Result Searches</h3>
          <p style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>Queries users searched but found nothing</p>
          <div className="admin-table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="admin-table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>Term</th>
                  <th>Count</th>
                  <th>Last Searched</th>
                </tr>
              </thead>
              <tbody>
                {zeroResults.map(s => (
                  <tr key={s.term}>
                    <td className="admin-cell-name">{s.term}</td>
                    <td>{s.count}</td>
                    <td className="admin-cell-muted">{s.lastSearched}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="admin-detail-grid" style={{ marginTop: 16 }}>
        {/* Search by Time */}
        <div className="admin-detail-card">
          <h3>Search Volume by Time</h3>
          <div style={{ marginTop: 12 }}>
            {searchByTime.map(s => (
              <div key={s.hour} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#888', width: 70, flexShrink: 0 }}>{s.hour}</span>
                <div style={{ flex: 1, height: 18, background: 'rgba(128,128,128,0.06)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${s.pct}%`, height: '100%', background: '#4caf50', borderRadius: 4, transition: 'width 0.3s' }} />
                </div>
                <span style={{ fontSize: 11, color: '#666', width: 50, textAlign: 'right' }}>{s.searches}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Searches */}
        <div className="admin-detail-card">
          <h3>Recent Searches</h3>
          <div className="admin-table-wrap" style={{ border: 'none', borderRadius: 0, marginTop: 8 }}>
            <table className="admin-table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Query</th>
                  <th>When</th>
                  <th>Clicked</th>
                </tr>
              </thead>
              <tbody>
                {recentSearches.map((s, i) => (
                  <tr key={i}>
                    <td className="admin-cell-name">{s.user}</td>
                    <td>{s.term}</td>
                    <td className="admin-cell-muted">{s.time}</td>
                    <td>
                      {s.clicked ? (
                        <span style={{ color: '#4caf50', fontSize: 11, fontWeight: 600 }}>Yes</span>
                      ) : (
                        <span style={{ color: '#ccc', fontSize: 11 }}>No</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Live Activity Tab ───

function LiveActivityTab() {
  const [entries, setEntries] = useState<LiveEntry[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const nextIdRef = useRef(1);
  const listRef = useRef<HTMLDivElement>(null);

  const addEntry = useCallback(() => {
    const entry: LiveEntry = {
      id: nextIdRef.current++,
      timestamp: new Date(),
      term: randomItem(SEARCH_TERMS),
      user: randomItem(USERNAMES),
      resultCount: Math.floor(Math.random() * 51),
      clickedThrough: Math.random() > 0.4,
    };
    setEntries(prev => [entry, ...prev].slice(0, 50));
  }, []);

  useEffect(() => {
    // Seed with a few initial entries
    for (let i = 0; i < 5; i++) {
      const delay = i * 200;
      const now = new Date(Date.now() - (5 - i) * 3000);
      setTimeout(() => {
        setEntries(prev => {
          const entry: LiveEntry = {
            id: nextIdRef.current++,
            timestamp: now,
            term: randomItem(SEARCH_TERMS),
            user: randomItem(USERNAMES),
            resultCount: Math.floor(Math.random() * 51),
            clickedThrough: Math.random() > 0.4,
          };
          return [entry, ...prev].slice(0, 50);
        });
      }, delay);
    }
  }, []);

  useEffect(() => {
    if (isPaused) return;
    const interval = setInterval(() => {
      addEntry();
    }, 2000 + Math.random() * 2000);
    return () => clearInterval(interval);
  }, [isPaused, addEntry]);

  const totalEntries = entries.length;
  const clickedCount = entries.filter(e => e.clickedThrough).length;
  const zeroResultCount = entries.filter(e => e.resultCount === 0).length;

  return (
    <div style={{ marginTop: 16 }}>
      {/* Live stats bar */}
      <div className="admin-stats-grid" style={{ marginBottom: 16 }}>
        <div className="admin-stat-card">
          <span className="admin-stat-value">{totalEntries}</span>
          <span className="admin-stat-label">Captured</span>
        </div>
        <div className="admin-stat-card">
          <span className="admin-stat-value">{totalEntries > 0 ? Math.round((clickedCount / totalEntries) * 100) : 0}%</span>
          <span className="admin-stat-label">Click-through</span>
        </div>
        <div className="admin-stat-card">
          <span className="admin-stat-value">{zeroResultCount}</span>
          <span className="admin-stat-label">Zero Results</span>
        </div>
      </div>

      {/* Feed container */}
      <div className="admin-detail-card" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Header bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid rgba(128,128,128,0.1)',
          background: 'rgba(0,0,0,0.15)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: isPaused ? '#666' : '#22c55e',
              display: 'inline-block',
              animation: isPaused ? 'none' : 'adminLivePulse 2s ease-in-out infinite',
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>
              {isPaused ? 'Paused' : 'Live Feed'}
            </span>
            <span style={{ fontSize: 11, color: '#888' }}>
              Consumer search activity
            </span>
          </div>
          <button
            onClick={() => setIsPaused(!isPaused)}
            style={{
              background: isPaused ? 'rgba(34,197,94,0.15)' : 'rgba(128,128,128,0.15)',
              border: '1px solid ' + (isPaused ? 'rgba(34,197,94,0.3)' : 'rgba(128,128,128,0.2)'),
              color: isPaused ? '#22c55e' : '#999',
              padding: '4px 12px',
              borderRadius: 6,
              fontSize: 11,
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            {isPaused ? 'Resume' : 'Pause'}
          </button>
        </div>

        {/* Column headers */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '100px 1fr 120px 80px 80px',
          padding: '8px 16px',
          borderBottom: '1px solid rgba(128,128,128,0.08)',
          fontSize: 10,
          fontWeight: 600,
          color: '#666',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          <span>Time</span>
          <span>Search Query</span>
          <span>User</span>
          <span style={{ textAlign: 'center' }}>Results</span>
          <span style={{ textAlign: 'center' }}>Clicked</span>
        </div>

        {/* Scrollable list */}
        <div
          ref={listRef}
          style={{
            maxHeight: 480,
            overflowY: 'auto',
          }}
        >
          {entries.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: '#666', fontSize: 13 }}>
              Waiting for search activity...
            </div>
          )}
          {entries.map((entry, index) => (
            <div
              key={entry.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '100px 1fr 120px 80px 80px',
                padding: '10px 16px',
                borderBottom: '1px solid rgba(128,128,128,0.05)',
                fontSize: 12,
                alignItems: 'center',
                animation: index === 0 ? 'adminFeedSlideIn 0.3s ease-out' : undefined,
                background: index === 0 ? 'rgba(34,197,94,0.03)' : 'transparent',
                transition: 'background 0.5s ease',
              }}
            >
              <span style={{ color: '#888', fontSize: 11, fontFamily: 'monospace' }}>
                {formatTimestamp(entry.timestamp)}
              </span>
              <span style={{ color: '#fff', fontWeight: 500 }}>
                {entry.term}
              </span>
              <span style={{ color: '#aaa' }}>
                {entry.user}
              </span>
              <span style={{
                textAlign: 'center',
                color: entry.resultCount === 0 ? '#f44336' : '#888',
                fontWeight: entry.resultCount === 0 ? 600 : 400,
              }}>
                {entry.resultCount}
              </span>
              <span style={{ textAlign: 'center' }}>
                {entry.clickedThrough ? (
                  <span style={{ color: '#22c55e', fontWeight: 600, fontSize: 11 }}>Yes</span>
                ) : (
                  <span style={{ color: '#555', fontSize: 11 }}>No</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes adminFeedSlideIn {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

// ─── Trends Tab ───

function TrendsTab() {
  return (
    <div style={{ marginTop: 16 }}>
      <div className="admin-detail-card" style={{ textAlign: 'center', padding: '60px 20px' }}>
        <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>&#x1F4C8;</div>
        <h3 style={{ marginBottom: 8, color: '#fff' }}>Search Trends Coming Soon</h3>
        <p style={{ color: '#888', fontSize: 13, maxWidth: 400, margin: '0 auto' }}>
          Trend analysis will show rising and falling search terms, seasonal patterns, and predictive insights based on user search behavior.
        </p>
      </div>
    </div>
  );
}
