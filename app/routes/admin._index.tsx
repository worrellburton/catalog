export default function AdminHome() {
  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Home</h1>
        <p className="admin-page-subtitle">Platform overview</p>
      </div>

      <div className="admin-stats-grid">
        <div className="admin-stat-card">
          <div className="admin-stat-label">Total Users</div>
          <div className="admin-stat-value">4</div>
          <div className="admin-stat-change positive">+2 this week</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-label">Creators</div>
          <div className="admin-stat-value">2</div>
          <div className="admin-stat-change positive">+1 this month</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-label">Total Looks</div>
          <div className="admin-stat-value">6</div>
          <div className="admin-stat-change positive">+3 this week</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-label">Products</div>
          <div className="admin-stat-value">24</div>
          <div className="admin-stat-change neutral">No change</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-label">Searches Today</div>
          <div className="admin-stat-value">128</div>
          <div className="admin-stat-change positive">+18%</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-label">Bookmarks</div>
          <div className="admin-stat-value">47</div>
          <div className="admin-stat-change positive">+12 this week</div>
        </div>
      </div>

      <div className="admin-home-grid">
        <div className="admin-home-card">
          <h3 className="admin-home-card-title">Recent Activity</h3>
          <div className="admin-activity-list">
            <div className="admin-activity-item">
              <span className="admin-activity-dot" style={{ background: '#4caf50' }} />
              <div className="admin-activity-content">
                <span>Carla saved 2 products</span>
                <span className="admin-activity-time">5 min ago</span>
              </div>
            </div>
            <div className="admin-activity-item">
              <span className="admin-activity-dot" style={{ background: '#2196f3' }} />
              <div className="admin-activity-content">
                <span>Lily Wittman uploaded Look 04</span>
                <span className="admin-activity-time">22 min ago</span>
              </div>
            </div>
            <div className="admin-activity-item">
              <span className="admin-activity-dot" style={{ background: '#ff9800' }} />
              <div className="admin-activity-content">
                <span>New waitlist signup: jenny_m</span>
                <span className="admin-activity-time">1 hr ago</span>
              </div>
            </div>
            <div className="admin-activity-item">
              <span className="admin-activity-dot" style={{ background: '#4caf50' }} />
              <div className="admin-activity-content">
                <span>alfvaz followed Lily Wittman</span>
                <span className="admin-activity-time">2 hr ago</span>
              </div>
            </div>
            <div className="admin-activity-item">
              <span className="admin-activity-dot" style={{ background: '#9c27b0' }} />
              <div className="admin-activity-content">
                <span>Garrett submitted 2 new looks</span>
                <span className="admin-activity-time">3 hr ago</span>
              </div>
            </div>
            <div className="admin-activity-item">
              <span className="admin-activity-dot" style={{ background: '#2196f3' }} />
              <div className="admin-activity-content">
                <span>franky90 searched "streetwear"</span>
                <span className="admin-activity-time">4 hr ago</span>
              </div>
            </div>
          </div>
        </div>

        <div className="admin-home-card">
          <h3 className="admin-home-card-title">Top Searches</h3>
          <div className="admin-home-rank-list">
            {[
              { term: 'streetwear', count: 342 },
              { term: 'minimal outfit', count: 281 },
              { term: 'summer looks', count: 245 },
              { term: 'festival', count: 198 },
              { term: 'casual friday', count: 156 },
            ].map((item, i) => (
              <div key={item.term} className="admin-home-rank-item">
                <span className="admin-home-rank-num">{i + 1}</span>
                <span className="admin-home-rank-term">{item.term}</span>
                <span className="admin-home-rank-count">{item.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="admin-home-card">
          <h3 className="admin-home-card-title">Pending Actions</h3>
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
    </div>
  );
}
