export default function AdminHome() {
  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Home</h1>
        <p className="admin-page-subtitle">Platform overview</p>
      </div>

      <div className="admin-stats-grid">
        <div className="admin-stat-card">
          <div className="admin-stat-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <div className="admin-stat-label">Total Users</div>
          <div className="admin-stat-value">4</div>
          <div className="admin-stat-change positive">+2 this week</div>
          <svg className="admin-sparkline" viewBox="0 0 80 24" preserveAspectRatio="none">
            <polyline className="admin-sparkline-line sparkline-up" points="0,20 12,18 24,16 36,14 48,12 60,8 72,6 80,4" />
          </svg>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14M3 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/></svg>
          </div>
          <div className="admin-stat-label">Creators</div>
          <div className="admin-stat-value">2</div>
          <div className="admin-stat-change positive">+1 this month</div>
          <svg className="admin-sparkline" viewBox="0 0 80 24" preserveAspectRatio="none">
            <polyline className="admin-sparkline-line sparkline-up" points="0,18 12,18 24,16 36,16 48,14 60,12 72,8 80,6" />
          </svg>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          </div>
          <div className="admin-stat-label">Total Looks</div>
          <div className="admin-stat-value">6</div>
          <div className="admin-stat-change positive">+3 this week</div>
          <svg className="admin-sparkline" viewBox="0 0 80 24" preserveAspectRatio="none">
            <polyline className="admin-sparkline-line sparkline-up" points="0,22 12,20 24,18 36,16 48,10 60,8 72,6 80,4" />
          </svg>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
          </div>
          <div className="admin-stat-label">Products</div>
          <div className="admin-stat-value">24</div>
          <div className="admin-stat-change neutral">No change</div>
          <svg className="admin-sparkline" viewBox="0 0 80 24" preserveAspectRatio="none">
            <polyline className="admin-sparkline-line sparkline-flat" points="0,12 12,12 24,11 36,12 48,12 60,11 72,12 80,12" />
          </svg>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>
          <div className="admin-stat-label">Searches Today</div>
          <div className="admin-stat-value">128</div>
          <div className="admin-stat-change positive">+18%</div>
          <svg className="admin-sparkline" viewBox="0 0 80 24" preserveAspectRatio="none">
            <polyline className="admin-sparkline-line sparkline-up" points="0,20 12,16 24,18 36,14 48,10 60,6 72,4 80,2" />
          </svg>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </div>
          <div className="admin-stat-label">Bookmarks</div>
          <div className="admin-stat-value">47</div>
          <div className="admin-stat-change positive">+12 this week</div>
          <svg className="admin-sparkline" viewBox="0 0 80 24" preserveAspectRatio="none">
            <polyline className="admin-sparkline-line sparkline-up" points="0,18 12,16 24,14 36,16 48,12 60,8 72,6 80,4" />
          </svg>
        </div>
      </div>

      <div className="admin-home-grid">
        <div className="admin-home-card">
          <h3 className="admin-home-card-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            Recent Activity
          </h3>
          <div className="admin-activity-list">
            {[
              { color: '#4caf50', avatar: 'https://i.pravatar.cc/32?img=5', text: 'Carla saved 2 products', time: '5 min ago' },
              { color: '#2196f3', avatar: 'https://i.pravatar.cc/32?img=47', text: 'Lily Wittman uploaded Look 04', time: '22 min ago' },
              { color: '#ff9800', avatar: 'https://i.pravatar.cc/32?img=23', text: 'New waitlist signup: jenny_m', time: '1 hr ago' },
              { color: '#4caf50', avatar: 'https://i.pravatar.cc/32?img=33', text: 'alfvaz followed Lily Wittman', time: '2 hr ago' },
              { color: '#9c27b0', avatar: 'https://i.pravatar.cc/32?img=12', text: 'Garrett submitted 2 new looks', time: '3 hr ago' },
              { color: '#2196f3', avatar: 'https://i.pravatar.cc/32?img=59', text: 'franky90 searched "streetwear"', time: '4 hr ago' },
            ].map((item, i) => (
              <div key={i} className="admin-activity-item">
                <img src={item.avatar} alt="" className="admin-activity-avatar" />
                <div className="admin-activity-content">
                  <span>{item.text}</span>
                  <span className="admin-activity-time">{item.time}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="admin-home-card">
          <h3 className="admin-home-card-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 6l-9.5 9.5-5-5L1 18"/><polyline points="17 6 23 6 23 12"/></svg>
            Top Searches
          </h3>
          <div className="admin-home-rank-list">
            {[
              { term: 'streetwear', count: 342, pct: 100 },
              { term: 'minimal outfit', count: 281, pct: 82 },
              { term: 'summer looks', count: 245, pct: 72 },
              { term: 'festival', count: 198, pct: 58 },
              { term: 'casual friday', count: 156, pct: 46 },
            ].map((item, i) => (
              <div key={item.term} className="admin-home-rank-item">
                <span className="admin-home-rank-num">{i + 1}</span>
                <div className="admin-rank-bar-wrap">
                  <span className="admin-home-rank-term">{item.term}</span>
                  <div className="admin-rank-bar">
                    <div className="admin-rank-bar-fill" style={{ width: `${item.pct}%`, animationDelay: `${i * 0.1}s` }} />
                  </div>
                </div>
                <span className="admin-home-rank-count">{item.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="admin-home-card">
          <h3 className="admin-home-card-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Pending Actions
          </h3>
          <div className="admin-home-pending">
            <div className="admin-home-pending-item">
              <div className="admin-home-pending-info">
                <span className="admin-home-pending-count">9</span>
                <span>Waitlist signups</span>
              </div>
              <span className="admin-status admin-status-warning">review</span>
            </div>
            <div className="admin-home-pending-item">
              <div className="admin-home-pending-info">
                <span className="admin-home-pending-count">3</span>
                <span>Incoming creators</span>
              </div>
              <span className="admin-status admin-status-warning">review</span>
            </div>
            <div className="admin-home-pending-item">
              <div className="admin-home-pending-info">
                <span className="admin-home-pending-count">2</span>
                <span>Flagged content</span>
              </div>
              <span className="admin-status admin-status-danger">urgent</span>
            </div>
          </div>
        </div>
      </div>

      {/* Weekly Activity Chart */}
      <div className="admin-home-card" style={{ marginTop: 16 }}>
        <h3 className="admin-home-card-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
          Weekly Activity
        </h3>
        <div className="admin-weekly-chart">
          {[
            { day: 'Mon', searches: 45, signups: 1, looks: 0 },
            { day: 'Tue', searches: 62, signups: 0, looks: 1 },
            { day: 'Wed', searches: 38, signups: 1, looks: 0 },
            { day: 'Thu', searches: 78, signups: 0, looks: 2 },
            { day: 'Fri', searches: 92, signups: 1, looks: 1 },
            { day: 'Sat', searches: 128, signups: 2, looks: 2 },
            { day: 'Sun', searches: 85, signups: 1, looks: 0 },
          ].map((d, i) => (
            <div key={d.day} className="admin-weekly-col">
              <div className="admin-weekly-bars">
                <div className="admin-weekly-bar searches" style={{ height: `${(d.searches / 128) * 100}%`, animationDelay: `${i * 0.08}s` }}>
                  <span className="admin-weekly-tooltip">{d.searches} searches</span>
                </div>
              </div>
              <span className="admin-weekly-label">{d.day}</span>
            </div>
          ))}
        </div>
        <div className="admin-chart-legend">
          <span className="admin-legend-item"><span className="admin-legend-dot" style={{ background: '#333' }} />Searches</span>
        </div>
      </div>
    </div>
  );
}
