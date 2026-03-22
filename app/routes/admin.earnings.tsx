import { useState } from 'react';

export default function AdminEarnings() {
  const [activeTab, setActiveTab] = useState<'clickouts' | 'earnings' | 'revenue'>('clickouts');

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Earnings</h1>
        <p className="admin-page-subtitle">Track clickouts, creator earnings, and platform revenue</p>
      </div>
      <div className="admin-tabs">
        <button className={`admin-tab ${activeTab === 'clickouts' ? 'active' : ''}`} onClick={() => setActiveTab('clickouts')}>Clickouts & Taps</button>
        <button className={`admin-tab ${activeTab === 'earnings' ? 'active' : ''}`} onClick={() => setActiveTab('earnings')}>Earnings</button>
        <button className={`admin-tab ${activeTab === 'revenue' ? 'active' : ''}`} onClick={() => setActiveTab('revenue')}>Revenue</button>
      </div>
      {activeTab === 'clickouts' && (
        <div className="admin-empty">No clickout data yet</div>
      )}
      {activeTab === 'earnings' && (
        <div className="admin-empty">No earnings data yet</div>
      )}
      {activeTab === 'revenue' && (
        <div className="admin-empty">No revenue data yet</div>
      )}
    </div>
  );
}
