import { useEffect, useState } from 'react';
import { getPlatformStats, type PlatformStats } from '~/services/stats';

export default function AdminHome() {
  const [stats, setStats] = useState<PlatformStats | null>(null);

  useEffect(() => {
    getPlatformStats().then(setStats);
  }, []);

  const s = stats ?? { totalUsers: 0, creators: 0, totalLooks: 0, products: 0, searchesToday: 0, bookmarks: 0 };

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
          <div className="admin-stat-value">{s.totalUsers}</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14M3 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/></svg>
          </div>
          <div className="admin-stat-label">Creators</div>
          <div className="admin-stat-value">{s.creators}</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          </div>
          <div className="admin-stat-label">Total Looks</div>
          <div className="admin-stat-value">{s.totalLooks}</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
          </div>
          <div className="admin-stat-label">Products</div>
          <div className="admin-stat-value">{s.products}</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>
          <div className="admin-stat-label">Searches Today</div>
          <div className="admin-stat-value">{s.searchesToday}</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </div>
          <div className="admin-stat-label">Bookmarks</div>
          <div className="admin-stat-value">{s.bookmarks}</div>
        </div>
      </div>

      <div className="admin-home-grid">
        <div className="admin-home-card">
          <h3 className="admin-home-card-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            Recent Activity
          </h3>
          <p className="admin-detail-empty">No activity yet</p>
        </div>

        <div className="admin-home-card">
          <h3 className="admin-home-card-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 6l-9.5 9.5-5-5L1 18"/><polyline points="17 6 23 6 23 12"/></svg>
            Top Searches
          </h3>
          <p className="admin-detail-empty">No searches yet</p>
        </div>

        <div className="admin-home-card">
          <h3 className="admin-home-card-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Pending Actions
          </h3>
          <p className="admin-detail-empty">Nothing pending</p>
        </div>
      </div>
    </div>
  );
}
