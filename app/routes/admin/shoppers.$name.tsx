import { useParams, useNavigate } from '@remix-run/react';

const userActivity: Record<string, { searches: string[]; clicks: string[]; saved: string[] }> = {
  'Carla': {
    searches: ['summer dresses', 'white sneakers', 'linen pants'],
    clicks: ['Rock Style Flap Shoulder Bag - Zara', 'Major Shade Cat Eye Sunglasses - Windsor'],
    saved: ['Look 07'],
  },
  'alfvaz': {
    searches: ['streetwear', 'dior sneakers', 'mens fashion'],
    clicks: ['B27 Uptown Low-Top Sneaker - Dior', 'Patchwork Pointelle Shirt - Vince'],
    saved: [],
  },
  'franky90': {
    searches: ['casual outfits', 'jeans'],
    clicks: ['Light Blue Straight Leg Jeans - Suitsupply'],
    saved: [],
  },
  'D1.barbershop': {
    searches: [],
    clicks: [],
    saved: [],
  },
};

export default function AdminShopperDetail() {
  const { name } = useParams();
  const navigate = useNavigate();
  const decoded = decodeURIComponent(name || '');
  const activity = userActivity[decoded] || { searches: [], clicks: [], saved: [] };

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <button className="admin-back-link" onClick={() => navigate('/admin/users')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          Back to Users
        </button>
        <h1>{decoded}</h1>
        <p className="admin-page-subtitle">Shopper profile and activity</p>
      </div>
      <div className="admin-detail-grid">
        <div className="admin-detail-card">
          <h3>Profile</h3>
          <div className="admin-detail-rows">
            <div className="admin-detail-row"><span>Username</span><span>{decoded}</span></div>
            <div className="admin-detail-row"><span>Status</span><span className="admin-status-active">Active</span></div>
            <div className="admin-detail-row"><span>Type</span><span>Shopper</span></div>
          </div>
        </div>
        <div className="admin-detail-card">
          <h3>Activity</h3>
          <div className="admin-detail-rows">
            <div className="admin-detail-row"><span>Saved</span><span>{activity.saved.length}</span></div>
            <div className="admin-detail-row"><span>Searches</span><span>{activity.searches.length}</span></div>
            <div className="admin-detail-row"><span>Clicks</span><span>{activity.clicks.length}</span></div>
          </div>
        </div>
      </div>
      <div className="admin-detail-grid" style={{ marginTop: 16 }}>
        <div className="admin-detail-card">
          <h3>Recent Searches</h3>
          {activity.searches.length === 0 ? (
            <p className="admin-detail-empty">No searches yet</p>
          ) : (
            <div className="admin-activity-list">
              {activity.searches.map((s, i) => (
                <div key={i} className="admin-activity-item">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <span>{s}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="admin-detail-card">
          <h3>Recent Clicks</h3>
          {activity.clicks.length === 0 ? (
            <p className="admin-detail-empty">No clicks yet</p>
          ) : (
            <div className="admin-activity-list">
              {activity.clicks.map((c, i) => (
                <div key={i} className="admin-activity-item">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  <span>{c}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {activity.saved.length > 0 && (
        <div className="admin-detail-grid" style={{ marginTop: 16 }}>
          <div className="admin-detail-card">
            <h3>Saved Looks</h3>
            <div className="admin-activity-list">
              {activity.saved.map((s, i) => (
                <div key={i} className="admin-activity-item">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                  <span>{s}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
