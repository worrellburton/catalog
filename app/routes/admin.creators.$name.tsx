import { useParams, useNavigate } from '@remix-run/react';

export default function AdminCreatorDetail() {
  const { name } = useParams();
  const navigate = useNavigate();

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <button className="admin-back-link" onClick={() => navigate('/admin/creators')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          Back to Creators
        </button>
        <h1>{decodeURIComponent(name || '')}</h1>
        <p className="admin-page-subtitle">Creator profile, looks, and analytics</p>
      </div>
      <div className="admin-detail-grid">
        <div className="admin-detail-card">
          <h3>Profile</h3>
          <div className="admin-detail-rows">
            <div className="admin-detail-row"><span>Username</span><span>{decodeURIComponent(name || '')}</span></div>
            <div className="admin-detail-row"><span>Status</span><span className="admin-status-active">Active</span></div>
          </div>
        </div>
        <div className="admin-detail-card">
          <h3>Activity</h3>
          <div className="admin-detail-rows">
            <div className="admin-detail-row"><span>Looks</span><span>0</span></div>
            <div className="admin-detail-row"><span>Followers</span><span>0</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
