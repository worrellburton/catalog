import { useState } from 'react';

const earningsData = [
  { date: 'Feb 10, 2026', creator: 'Garrett', taps: 1, reward: '$0.00', payout: '$1.25' },
  { date: 'Feb 10, 2026', creator: 'kylee.dwyer', taps: 1, reward: '$0.00', payout: '$1.25' },
  { date: 'Feb 10, 2026', creator: 'emmanuel.mukushi', taps: 2, reward: '$0.00', payout: '$2.50' },
  { date: 'Feb 09, 2026', creator: 'Lily Wittman', taps: 5, reward: '$0.00', payout: '$6.25' },
  { date: 'Feb 09, 2026', creator: 'Garrett', taps: 3, reward: '$0.00', payout: '$3.75' },
  { date: 'Feb 08, 2026', creator: 'kylee.dwyer', taps: 4, reward: '$0.00', payout: '$5.00' },
];

const creatorsForPayout = [
  { name: 'anitaaruiz', verified: true },
  { name: 'Garrett', verified: false },
  { name: 'Lily Wittman', verified: true },
  { name: 'kylee.dwyer', verified: false },
  { name: 'emmanuel.mukushi', verified: true },
];

export default function AdminEarnings() {
  const [dateFilter, setDateFilter] = useState('02/10/2026');
  const [dailyPayout, setDailyPayout] = useState('5');
  const [cac, setCac] = useState('2');
  const [showSettings, setShowSettings] = useState(false);
  const [showCreatePayout, setShowCreatePayout] = useState(false);
  const [payoutSearch, setPayoutSearch] = useState('');

  const filtered = earningsData.filter(e => {
    if (!dateFilter) return true;
    const parts = dateFilter.split('/');
    if (parts.length === 3) {
      const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const m = parseInt(parts[0]);
      const d = parseInt(parts[1]);
      const filterStr = `${monthNames[m]} ${d.toString().padStart(2, '0')}, ${parts[2]}`;
      return e.date === filterStr;
    }
    return true;
  });

  const filteredCreators = creatorsForPayout.filter(c =>
    c.name.toLowerCase().includes(payoutSearch.toLowerCase())
  );

  return (
    <div className="admin-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0 }}>Earnings</h1>
          <p className="admin-page-subtitle" style={{ margin: '4px 0 0' }}>Track creator payouts</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="text"
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
            className="admin-date-input"
            placeholder="MM/DD/YYYY"
          />
          <button className="admin-icon-btn" aria-label="Calendar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </button>
          <button className="admin-icon-btn" aria-label="Export">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <div style={{ position: 'relative' }}>
            <button className="admin-icon-btn" aria-label="Payout settings" onClick={() => setShowSettings(!showSettings)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 1 1 0 7H6"/></svg>
            </button>
            {showSettings && (
              <div className="admin-popover">
                <div className="admin-popover-field">
                  <label>Daily Payout Value</label>
                  <div className="admin-popover-input-wrap">
                    <span className="admin-popover-input-prefix">$</span>
                    <input type="number" value={dailyPayout} onChange={e => setDailyPayout(e.target.value)} />
                  </div>
                </div>
                <div className="admin-popover-field">
                  <label>Customer Acquisition Cost</label>
                  <div className="admin-popover-input-wrap">
                    <span className="admin-popover-input-prefix">$</span>
                    <input type="number" value={cac} onChange={e => setCac(e.target.value)} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Creator</th>
              <th style={{ color: '#1976d2' }}># Of Taps</th>
              <th style={{ color: '#1976d2' }}>Reward</th>
              <th style={{ color: '#2e7d32', textAlign: 'right' }}>Daily Revenue Payout</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, i) => (
              <tr key={i}>
                <td className="admin-cell-muted">{row.date}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="admin-user-avatar" style={{ background: '#e0e0e0', width: 28, height: 28, fontSize: 10 }}>
                      {row.creator.slice(0, 2).toUpperCase()}
                    </span>
                    <span>{row.creator}</span>
                  </div>
                </td>
                <td style={{ color: '#1976d2', fontWeight: 600 }}>{row.taps}</td>
                <td>{row.reward}</td>
                <td style={{ color: '#2e7d32', fontWeight: 600, textAlign: 'right' }}>{row.payout}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: '#999' }}>No earnings for this date</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 24 }}>
        <button
          className="admin-action-btn approve"
          style={{ padding: '8px 16px', fontSize: 12 }}
          onClick={() => setShowCreatePayout(!showCreatePayout)}
        >
          {showCreatePayout ? 'Close' : 'Create Payout'}
        </button>
      </div>

      {showCreatePayout && (
        <div className="admin-table-wrap" style={{ marginTop: 16, padding: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>Create Payout</h3>
          <input
            type="text"
            placeholder="Search creator..."
            value={payoutSearch}
            onChange={e => setPayoutSearch(e.target.value)}
            className="admin-date-input"
            style={{ width: '100%', marginBottom: 12 }}
          />
          {filteredCreators.map(c => (
            <div key={c.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="admin-user-avatar" style={{ background: '#e0e0e0', width: 28, height: 28, fontSize: 10 }}>
                  {c.name.slice(0, 2).toUpperCase()}
                </span>
                <span style={{ fontSize: 12, fontWeight: 500 }}>{c.name}</span>
                {c.verified && <span className="admin-status admin-status-online" style={{ fontSize: 9 }}>DOTS VERIFIED</span>}
              </div>
              <button className="admin-action-btn approve">Select</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
