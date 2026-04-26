import { useState, useEffect, useMemo, useCallback } from 'react';
import { looks, creators } from '~/data/looks';
import { supabase } from '~/utils/supabase';
import { boostAd } from '~/services/product-creative';

interface SearchLog {
  id: string;
  query: string;
  user_handle: string | null;
  results_count: number;
  created_at: string;
}

interface DayCount {
  day: string;
  label: string;
  count: number;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function getLast7Days(): { day: string; label: string }[] {
  const days: { day: string; label: string }[] = [];
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({
      day: d.toISOString().split('T')[0],
      label: labels[d.getDay()],
    });
  }
  return days;
}

export default function AdminHome() {
  const [totalUsers, setTotalUsers] = useState<number | null>(null);
  const [productsCount, setProductsCount] = useState<number | null>(null);
  const [searchesToday, setSearchesToday] = useState<number | null>(null);
  const [recentActivity, setRecentActivity] = useState<SearchLog[]>([]);
  const [allSearchLogs, setAllSearchLogs] = useState<SearchLog[]>([]);
  const [weeklyData, setWeeklyData] = useState<DayCount[]>([]);
  const [trending, setTrending] = useState<Array<{
    id: string;
    productName: string;
    brand: string;
    image: string | null;
    impressions: number;
    clicks: number;
    ctr: number;
    createdAt: string;
    boostedUntil: string | null;
  }>>([]);
  const [boostingId, setBoostingId] = useState<string | null>(null);

  const loadTrending = useCallback(async () => {
    if (!supabase) return;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('product_creative')
      .select('id, impressions, clicks, created_at, boosted_until, product:products(name, brand, image_url)')
      .eq('status', 'live')
      .gte('created_at', sevenDaysAgo)
      .gte('impressions', 100);
    if (!data) return;
    const rows = (data as unknown as Array<{
      id: string;
      impressions: number;
      clicks: number;
      created_at: string;
      boosted_until: string | null;
      product: { name: string | null; brand: string | null; image_url: string | null } | null;
    }>)
      .map(r => ({
        id: r.id,
        productName: r.product?.name || 'Unnamed',
        brand: r.product?.brand || '—',
        image: r.product?.image_url || null,
        impressions: r.impressions || 0,
        clicks: r.clicks || 0,
        ctr: (r.impressions || 0) > 0 ? ((r.clicks || 0) / r.impressions) * 100 : 0,
        createdAt: r.created_at,
        boostedUntil: r.boosted_until,
      }))
      .filter(r => r.ctr >= 3)
      .sort((a, b) => b.ctr - a.ctr)
      .slice(0, 5);
    setTrending(rows);
  }, []);

  useEffect(() => { loadTrending(); }, [loadTrending]);

  const handleBoost = async (id: string) => {
    setBoostingId(id);
    await boostAd(id, 24);
    await loadTrending();
    setBoostingId(null);
  };

  // Local data counts — single source of truth
  const creatorsCount = Object.keys(creators).length;
  const looksCount = looks.length;

  // Count unique products across all looks as fallback
  const localProductsCount = useMemo(() => {
    const unique = new Set<string>();
    for (const look of looks) {
      for (const p of look.products) {
        unique.add(`${p.brand}::${p.name}`);
      }
    }
    return unique.size;
  }, []);

  useEffect(() => {
    async function fetchStats() {
      if (!supabase) return;
      // Total Users from profiles
      const { count: usersCount } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true });
      setTotalUsers(usersCount ?? 0);

      // Products from Supabase, fallback to unique products from looks data
      const { count: dbProducts } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true });
      setProductsCount(dbProducts ?? localProductsCount);

      // Searches today
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { count: todaySearches } = await supabase
        .from('search_logs')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', todayStart.toISOString());
      setSearchesToday(todaySearches ?? 0);

      // Recent activity (last 6 search logs)
      const { data: recentLogs } = await supabase
        .from('search_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(6);
      setRecentActivity(recentLogs ?? []);

      // All search logs for top searches
      const { data: allLogs } = await supabase
        .from('search_logs')
        .select('*')
        .order('created_at', { ascending: false });
      setAllSearchLogs(allLogs ?? []);

      // Weekly search data (last 7 days)
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - 6);
      weekStart.setHours(0, 0, 0, 0);
      const { data: weekLogs } = await supabase
        .from('search_logs')
        .select('created_at')
        .gte('created_at', weekStart.toISOString());

      const last7 = getLast7Days();
      const dayCounts: DayCount[] = last7.map(({ day, label }) => {
        const count = (weekLogs ?? []).filter(
          (log) => log.created_at.split('T')[0] === day
        ).length;
        return { day, label, count };
      });
      setWeeklyData(dayCounts);
    }

    fetchStats();
  }, [localProductsCount]);

  // Top searches: group by query, sort by count
  const topSearches = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const log of allSearchLogs) {
      const q = log.query.toLowerCase().trim();
      counts[q] = (counts[q] || 0) + 1;
    }
    const sorted = Object.entries(counts)
      .map(([term, count]) => ({ term, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    const max = sorted[0]?.count ?? 1;
    return sorted.map((s) => ({ ...s, pct: (s.count / max) * 100 }));
  }, [allSearchLogs]);

  const maxWeekly = Math.max(...weeklyData.map((d) => d.count), 1);

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Home</h1>
        <p className="admin-page-subtitle">Platform overview</p>
      </div>

      <div
        className="admin-stats-grid"
        style={{
          gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div className="admin-stat-card">
          <div className="admin-stat-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <div className="admin-stat-label">Total Users</div>
          <div className="admin-stat-value">{totalUsers ?? '...'}</div>
          <div className="admin-stat-change neutral">&mdash;</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14M3 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/></svg>
          </div>
          <div className="admin-stat-label">Creators</div>
          <div className="admin-stat-value">{creatorsCount}</div>
          <div className="admin-stat-change neutral">&mdash;</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          </div>
          <div className="admin-stat-label">Total Looks</div>
          <div className="admin-stat-value">{looksCount}</div>
          <div className="admin-stat-change neutral">&mdash;</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
          </div>
          <div className="admin-stat-label">Products</div>
          <div className="admin-stat-value">{productsCount ?? '...'}</div>
          <div className="admin-stat-change neutral">&mdash;</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>
          <div className="admin-stat-label">Searches Today</div>
          <div className="admin-stat-value">{searchesToday ?? '...'}</div>
          <div className="admin-stat-change neutral">&mdash;</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </div>
          <div className="admin-stat-label">Bookmarks</div>
          <div className="admin-stat-value">0</div>
          <div className="admin-stat-change neutral">&mdash;</div>
        </div>
      </div>

      {/* Trending card */}
      {trending.length > 0 && (
        <div className="admin-home-card" style={{ marginBottom: 16, border: '1px solid #fde68a', background: '#fffbeb' }}>
          <h3 className="admin-home-card-title" style={{ color: '#b45309' }}>
            🔥 Trending this week
            <span style={{ fontSize: 11, fontWeight: 500, color: '#92400e', marginLeft: 8 }}>
              CTR ≥ 3%, last 7 days, 100+ impressions
            </span>
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            {trending.map((t, i) => {
              const isBoosted = t.boostedUntil && new Date(t.boostedUntil).getTime() > Date.now();
              return (
                <div key={t.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
                  background: '#fff', borderRadius: 8, border: '1px solid #fde68a',
                }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#b45309', width: 20 }}>#{i + 1}</span>
                  {t.image && <img src={t.image} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover' }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.productName}
                    </div>
                    <div style={{ fontSize: 10, color: '#888' }}>
                      {t.brand} · {t.impressions.toLocaleString()} imp · {t.clicks.toLocaleString()} clicks
                    </div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#16a34a', minWidth: 56, textAlign: 'right' }}>
                    {t.ctr.toFixed(2)}%
                  </div>
                  {isBoosted ? (
                    <span style={{
                      padding: '3px 10px', borderRadius: 999, background: '#f97316', color: '#fff',
                      fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
                    }}>
                      Boosted
                    </span>
                  ) : (
                    <button
                      className="admin-btn admin-btn-primary"
                      style={{ fontSize: 11, padding: '4px 10px' }}
                      disabled={boostingId === t.id}
                      onClick={() => handleBoost(t.id)}
                    >
                      {boostingId === t.id ? 'Boosting…' : 'Boost 24h'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="admin-home-grid">
        <div className="admin-home-card">
          <h3 className="admin-home-card-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            Recent Activity
          </h3>
          <div className="admin-activity-list">
            {recentActivity.length === 0 ? (
              <div className="admin-activity-empty">No activity yet</div>
            ) : (
              recentActivity.map((log) => (
                <div key={log.id} className="admin-activity-item">
                  <div className="admin-activity-icon-circle">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  </div>
                  <div className="admin-activity-content">
                    <span>
                      {log.user_handle ? log.user_handle : 'Anonymous'}{' '}
                      searched &ldquo;{log.query}&rdquo;
                    </span>
                    <span className="admin-activity-time">
                      {timeAgo(log.created_at)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="admin-home-card">
          <h3 className="admin-home-card-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 6l-9.5 9.5-5-5L1 18"/><polyline points="17 6 23 6 23 12"/></svg>
            Top Searches
          </h3>
          <div className="admin-home-rank-list">
            {topSearches.length === 0 ? (
              <div className="admin-activity-empty">No searches yet</div>
            ) : (
              topSearches.map((item, i) => (
                <div key={item.term} className="admin-home-rank-item">
                  <span className="admin-home-rank-num">{i + 1}</span>
                  <div className="admin-rank-bar-wrap">
                    <span className="admin-home-rank-term">{item.term}</span>
                    <div className="admin-rank-bar">
                      <div
                        className="admin-rank-bar-fill"
                        style={{
                          width: `${item.pct}%`,
                          animationDelay: `${i * 0.1}s`,
                        }}
                      />
                    </div>
                  </div>
                  <span className="admin-home-rank-count">{item.count}</span>
                </div>
              ))
            )}
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
                <span className="admin-home-pending-count">0</span>
                <span>Waitlist signups</span>
              </div>
              <span className="admin-status admin-status-neutral">nothing pending</span>
            </div>
            <div className="admin-home-pending-item">
              <div className="admin-home-pending-info">
                <span className="admin-home-pending-count">0</span>
                <span>Incoming creators</span>
              </div>
              <span className="admin-status admin-status-neutral">nothing pending</span>
            </div>
            <div className="admin-home-pending-item">
              <div className="admin-home-pending-info">
                <span className="admin-home-pending-count">0</span>
                <span>Flagged content</span>
              </div>
              <span className="admin-status admin-status-neutral">nothing pending</span>
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
          {weeklyData.map((d, i) => (
            <div key={d.day} className="admin-weekly-col">
              <div className="admin-weekly-bars">
                <div
                  className="admin-weekly-bar searches"
                  style={{
                    height: d.count > 0 ? `${(d.count / maxWeekly) * 100}%` : '2%',
                    animationDelay: `${i * 0.08}s`,
                  }}
                >
                  <span className="admin-weekly-tooltip">
                    {d.count} searches
                  </span>
                </div>
              </div>
              <span className="admin-weekly-label">{d.label}</span>
            </div>
          ))}
        </div>
        <div className="admin-chart-legend">
          <span className="admin-legend-item">
            <span className="admin-legend-dot" style={{ background: '#333' }} />
            Searches
          </span>
        </div>
      </div>
    </div>
  );
}
