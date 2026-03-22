import { useState } from 'react';

type Tab = 'ads' | 'campaigns' | 'audiences' | 'signup-links';

export default function AdminAdvertisements() {
  const [activeTab, setActiveTab] = useState<Tab>('ads');

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Advertisements</h1>
        <p className="admin-page-subtitle">Manage ads, campaigns, audiences, and signup links</p>
      </div>
      <div className="admin-tabs">
        <button className={`admin-tab ${activeTab === 'ads' ? 'active' : ''}`} onClick={() => setActiveTab('ads')}>Ads</button>
        <button className={`admin-tab ${activeTab === 'campaigns' ? 'active' : ''}`} onClick={() => setActiveTab('campaigns')}>Campaigns</button>
        <button className={`admin-tab ${activeTab === 'audiences' ? 'active' : ''}`} onClick={() => setActiveTab('audiences')}>Audiences</button>
        <button className={`admin-tab ${activeTab === 'signup-links' ? 'active' : ''}`} onClick={() => setActiveTab('signup-links')}>Signup Links</button>
      </div>

      {activeTab === 'ads' && (
        <div className="admin-empty">No advertisements yet</div>
      )}
      {activeTab === 'campaigns' && (
        <div className="admin-empty">No campaigns yet</div>
      )}
      {activeTab === 'audiences' && (
        <div className="admin-empty">No audience segments yet</div>
      )}
      {activeTab === 'signup-links' && (
        <div className="admin-empty">No signup links yet</div>
      )}
    </div>
  );
}
