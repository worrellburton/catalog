import { useState, useEffect, useRef } from 'react';
import { supabase } from '~/utils/supabase';

interface LiveEntry {
  id: string;
  created_at: string;
  query: string;
  user_handle: string | null;
  results_count: number;
  clicked: boolean;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
}

// --- Component ---

export default function AdminSearch() {
  const [activeTab, setActiveTab] = useState<'live' | 'overview' | 'trends'>('live');

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Search</h1>
        <p className="admin-page-subtitle">Search analytics and discovery insights</p>
      </div>

      <div className="admin-tabs">
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
        <button className={`admin-tab ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>Overview</button>
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

// ─── Overview Tab (real data from Supabase) ───

interface OverviewStats {
  totalSearches: number;
  uniqueTerms: number;
  avgResults: number;
  clickThrough: number;
  zeroResultsPct: number;
  searchesPerUser: number;
}

interface TopSearch {
  term: string;
  count: number;
}

interface ZeroResultSearch {
  term: string;
  count: number;
  lastSearched: string;
}

interface TimeSlot {
  hour: string;
  searches: number;
  pct: number;
}

interface RecentSearch {
  id: string;
  user: string;
  term: string;
  time: string;
  clicked: boolean;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function OverviewTab() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<OverviewStats>({ totalSearches: 0, uniqueTerms: 0, avgResults: 0, clickThrough: 0, zeroResultsPct: 0, searchesPerUser: 0 });
  const [topSearches, setTopSearches] = useState<TopSearch[]>([]);
  const [zeroResults, setZeroResults] = useState<ZeroResultSearch[]>([]);
  const [searchByTime, setSearchByTime] = useState<TimeSlot[]>([]);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }

    async function fetchOverviewData() {
      try {
        // Fetch all search logs for aggregation
        const [allLogsRes, recentRes] = await Promise.all([
          supabase!.from('search_logs').select('query, user_handle, results_count, clicked, created_at'),
          supabase!.from('search_logs')
            .select('id, created_at, query, user_handle, clicked')
            .order('created_at', { ascending: false })
            .limit(10),
        ]);

        const allLogs = allLogsRes.data || [];
        const recentData = recentRes.data || [];

        // --- Stats ---
        const total = allLogs.length;
        const uniqueTermsSet = new Set(allLogs.map(r => r.query?.toLowerCase()));
        const uniqueTerms = uniqueTermsSet.size;
        const avgResults = total > 0
          ? allLogs.reduce((sum, r) => sum + (r.results_count || 0), 0) / total
          : 0;
        const clickedCount = allLogs.filter(r => r.clicked).length;
        const clickThrough = total > 0 ? (clickedCount / total) * 100 : 0;
        const zeroCount = allLogs.filter(r => r.results_count === 0).length;
        const zeroResultsPct = total > 0 ? (zeroCount / total) * 100 : 0;
        const uniqueUsers = new Set(allLogs.map(r => r.user_handle).filter(Boolean));
        const searchesPerUser = uniqueUsers.size > 0 ? total / uniqueUsers.size : 0;

        setStats({
          totalSearches: total,
          uniqueTerms,
          avgResults: Math.round(avgResults * 10) / 10,
          clickThrough: Math.round(clickThrough),
          zeroResultsPct: Math.round(zeroResultsPct),
          searchesPerUser: Math.round(searchesPerUser * 10) / 10,
        });

        // --- Top Searches ---
        const termCounts: Record<string, number> = {};
        for (const row of allLogs) {
          const q = row.query?.toLowerCase() || '';
          termCounts[q] = (termCounts[q] || 0) + 1;
        }
        const sortedTerms = Object.entries(termCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([term, count]) => ({ term, count }));
        setTopSearches(sortedTerms);

        // --- Zero Result Searches ---
        const zeroLogs = allLogs.filter(r => r.results_count === 0);
        const zeroTermMap: Record<string, { count: number; lastSearched: string }> = {};
        for (const row of zeroLogs) {
          const q = row.query?.toLowerCase() || '';
          if (!zeroTermMap[q]) {
            zeroTermMap[q] = { count: 0, lastSearched: row.created_at };
          }
          zeroTermMap[q].count += 1;
          if (row.created_at > zeroTermMap[q].lastSearched) {
            zeroTermMap[q].lastSearched = row.created_at;
          }
        }
        const sortedZero = Object.entries(zeroTermMap)
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 5)
          .map(([term, data]) => ({
            term,
            count: data.count,
            lastSearched: new Date(data.lastSearched).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          }));
        setZeroResults(sortedZero);

        // --- Search Volume by Time (4-hour buckets) ---
        const bucketLabels = ['12am-4am', '4am-8am', '8am-12pm', '12pm-4pm', '4pm-8pm', '8pm-12am'];
        const bucketCounts = [0, 0, 0, 0, 0, 0];
        for (const row of allLogs) {
          const hour = new Date(row.created_at).getHours();
          const bucketIndex = Math.floor(hour / 4);
          bucketCounts[bucketIndex] += 1;
        }
        const maxBucket = Math.max(...bucketCounts, 1);
        const timeSlots: TimeSlot[] = bucketLabels.map((label, i) => ({
          hour: label,
          searches: bucketCounts[i],
          pct: Math.round((bucketCounts[i] / maxBucket) * 100),
        }));
        setSearchByTime(timeSlots);

        // --- Recent Searches ---
        const recent: RecentSearch[] = recentData.map(r => ({
          id: r.id,
          user: r.user_handle || '—',
          term: r.query,
          time: formatRelativeTime(r.created_at),
          clicked: r.clicked,
        }));
        setRecentSearches(recent);
      } catch (err) {
        console.error('[OverviewTab] fetch error:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchOverviewData();
  }, []);

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: '#888', fontSize: 13 }}>
        Loading overview data...
      </div>
    );
  }

  const hasData = stats.totalSearches > 0;

  const statCards = [
    { label: 'Total Searches', value: stats.totalSearches.toLocaleString() },
    { label: 'Unique Terms', value: stats.uniqueTerms.toLocaleString() },
    { label: 'Avg. Results', value: String(stats.avgResults) },
    { label: 'Click-through', value: `${stats.clickThrough}%` },
    { label: 'Zero Results', value: `${stats.zeroResultsPct}%` },
    { label: 'Searches/User', value: String(stats.searchesPerUser) },
  ];

  return (
    <>
      <div className="admin-stats-grid">
        {statCards.map(s => (
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
          {topSearches.length === 0 ? (
            <p style={{ fontSize: 12, color: '#888', padding: '20px 0', textAlign: 'center' }}>No searches yet</p>
          ) : (
            <div className="admin-table-wrap" style={{ border: 'none', borderRadius: 0, marginTop: 8 }}>
              <table className="admin-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Term</th>
                    <th>Count</th>
                    <th>Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {topSearches.map((s, i) => (
                    <tr key={s.term}>
                      <td className="admin-cell-muted">{i + 1}</td>
                      <td className="admin-cell-name">{s.term}</td>
                      <td>{s.count}</td>
                      <td className="admin-cell-muted">—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Zero Results */}
        <div className="admin-detail-card">
          <h3>Zero Result Searches</h3>
          <p style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>Queries users searched but found nothing</p>
          {zeroResults.length === 0 ? (
            <p style={{ fontSize: 12, color: '#888', padding: '20px 0', textAlign: 'center' }}>
              {hasData ? 'No zero-result searches found' : 'No searches yet'}
            </p>
          ) : (
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
          )}
        </div>
      </div>

      <div className="admin-detail-grid" style={{ marginTop: 16 }}>
        {/* Search by Time */}
        <div className="admin-detail-card">
          <h3>Search Volume by Time</h3>
          {!hasData ? (
            <p style={{ fontSize: 12, color: '#888', padding: '20px 0', textAlign: 'center' }}>No searches yet</p>
          ) : (
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
          )}
        </div>

        {/* Recent Searches */}
        <div className="admin-detail-card">
          <h3>Recent Searches</h3>
          {recentSearches.length === 0 ? (
            <p style={{ fontSize: 12, color: '#888', padding: '20px 0', textAlign: 'center' }}>No searches yet</p>
          ) : (
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
                  {recentSearches.map((s) => (
                    <tr key={s.id}>
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
          )}
        </div>
      </div>
    </>
  );
}

// ─── Live Activity Tab ───

function LiveActivityTab() {
  const [entries, setEntries] = useState<LiveEntry[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  // Initial fetch
  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase
      .from('search_logs')
      .select('id, created_at, query, user_handle, results_count, clicked')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (error) console.error('[search_logs] load failed:', error.message);
        if (data) setEntries(data as LiveEntry[]);
        setLoading(false);
      });
  }, []);

  // Realtime subscription
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel('search_logs_live')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'search_logs',
      }, (payload) => {
        if (isPausedRef.current) return;
        const row = payload.new as LiveEntry;
        setEntries(prev => [row, ...prev].slice(0, 50));
      })
      .subscribe();
    return () => { supabase!.removeChannel(channel); };
  }, []);

  const totalEntries = entries.length;
  const clickedCount = entries.filter(e => e.clicked).length;
  const zeroResultCount = entries.filter(e => e.results_count === 0).length;

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
          borderBottom: '1px solid #eee',
          background: '#fafafa',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: isPaused ? '#9ca3af' : '#22c55e',
              display: 'inline-block',
              animation: isPaused ? 'none' : 'adminLivePulse 2s ease-in-out infinite',
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>
              {isPaused ? 'Paused' : 'Live Feed'}
            </span>
            <span style={{ fontSize: 11, color: '#888' }}>
              Consumer search activity
            </span>
          </div>
          <button
            onClick={() => setIsPaused(!isPaused)}
            style={{
              background: isPaused ? 'rgba(34,197,94,0.12)' : '#f3f4f6',
              border: '1px solid ' + (isPaused ? 'rgba(34,197,94,0.3)' : '#e5e7eb'),
              color: isPaused ? '#16a34a' : '#374151',
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
          {loading && entries.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: '#666', fontSize: 13 }}>
              Loading search activity…
            </div>
          )}
          {!loading && entries.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: '#666', fontSize: 13 }}>
              No search activity yet. Searches from the consumer feed will appear here in real-time.
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
                {formatTimestamp(entry.created_at)}
              </span>
              <span style={{ color: '#111', fontWeight: 500 }}>
                {entry.query}
              </span>
              <span style={{ color: '#666' }}>
                {entry.user_handle || '—'}
              </span>
              <span style={{
                textAlign: 'center',
                color: entry.results_count === 0 ? '#dc2626' : '#666',
                fontWeight: entry.results_count === 0 ? 600 : 400,
              }}>
                {entry.results_count}
              </span>
              <span style={{ textAlign: 'center' }}>
                {entry.clicked ? (
                  <span style={{ color: '#16a34a', fontWeight: 600, fontSize: 11 }}>Yes</span>
                ) : (
                  <span style={{ color: '#999', fontSize: 11 }}>No</span>
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

// ─── Trends Tab (real data from Supabase) ───

interface TrendTerm {
  term: string;
  currentCount: number;
  previousCount: number;
  change: number;
}

interface DailyCount {
  date: string;
  count: number;
}

interface FilterCount {
  filter: string;
  count: number;
  pct: number;
}

function TrendsTab() {
  const [loading, setLoading] = useState(true);
  const [risingTerms, setRisingTerms] = useState<TrendTerm[]>([]);
  const [decliningTerms, setDecliningTerms] = useState<TrendTerm[]>([]);
  const [dailyActivity, setDailyActivity] = useState<DailyCount[]>([]);
  const [filterCounts, setFilterCounts] = useState<FilterCount[]>([]);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }

    async function fetchTrendsData() {
      try {
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

        // Fetch last 14 days of data for trends and daily activity
        const { data: twoWeekData } = await supabase!
          .from('search_logs')
          .select('query, created_at, filter')
          .gte('created_at', fourteenDaysAgo)
          .order('created_at', { ascending: false });

        const allRows = twoWeekData || [];

        // --- Rising / Declining Terms ---
        const currentWeek: Record<string, number> = {};
        const previousWeek: Record<string, number> = {};

        for (const row of allRows) {
          const q = row.query?.toLowerCase() || '';
          if (row.created_at >= sevenDaysAgo) {
            currentWeek[q] = (currentWeek[q] || 0) + 1;
          } else {
            previousWeek[q] = (previousWeek[q] || 0) + 1;
          }
        }

        const allTerms = new Set([...Object.keys(currentWeek), ...Object.keys(previousWeek)]);
        const trendTerms: TrendTerm[] = [];
        for (const term of allTerms) {
          const curr = currentWeek[term] || 0;
          const prev = previousWeek[term] || 0;
          const change = curr - prev;
          trendTerms.push({ term, currentCount: curr, previousCount: prev, change });
        }

        const rising = trendTerms
          .filter(t => t.change > 0)
          .sort((a, b) => b.change - a.change)
          .slice(0, 10);
        setRisingTerms(rising);

        const declining = trendTerms
          .filter(t => t.change < 0)
          .sort((a, b) => a.change - b.change)
          .slice(0, 10);
        setDecliningTerms(declining);

        // --- Daily Activity (last 14 days) ---
        const dailyMap: Record<string, number> = {};
        for (let i = 13; i >= 0; i--) {
          const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
          const key = d.toISOString().slice(0, 10);
          dailyMap[key] = 0;
        }
        for (const row of allRows) {
          const key = row.created_at.slice(0, 10);
          if (key in dailyMap) {
            dailyMap[key] += 1;
          }
        }
        const daily: DailyCount[] = Object.entries(dailyMap).map(([date, count]) => ({ date, count }));
        setDailyActivity(daily);

        // --- Popular Filters ---
        const filterMap: Record<string, number> = {};
        for (const row of allRows) {
          const f = row.filter || 'all';
          filterMap[f] = (filterMap[f] || 0) + 1;
        }
        const totalFiltered = allRows.length || 1;
        const filters: FilterCount[] = Object.entries(filterMap)
          .sort((a, b) => b[1] - a[1])
          .map(([filter, count]) => ({
            filter,
            count,
            pct: Math.round((count / totalFiltered) * 100),
          }));
        setFilterCounts(filters);
      } catch (err) {
        console.error('[TrendsTab] fetch error:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchTrendsData();
  }, []);

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: '#888', fontSize: 13 }}>
        Loading trends data...
      </div>
    );
  }

  const hasData = dailyActivity.some(d => d.count > 0);
  const maxDaily = Math.max(...dailyActivity.map(d => d.count), 1);

  return (
    <div style={{ marginTop: 16 }}>
      <div className="admin-detail-grid">
        {/* Rising Terms */}
        <div className="admin-detail-card">
          <h3>Rising Terms</h3>
          <p style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>Terms with the most growth (last 7 days vs previous 7 days)</p>
          {risingTerms.length === 0 ? (
            <p style={{ fontSize: 12, color: '#888', padding: '20px 0', textAlign: 'center' }}>
              {hasData ? 'No rising terms detected in this period' : 'No trend data yet — searches will be analyzed once enough data is collected.'}
            </p>
          ) : (
            <div className="admin-table-wrap" style={{ border: 'none', borderRadius: 0 }}>
              <table className="admin-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Term</th>
                    <th>This Week</th>
                    <th>Last Week</th>
                    <th>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {risingTerms.map(t => (
                    <tr key={t.term}>
                      <td className="admin-cell-name">{t.term}</td>
                      <td>{t.currentCount}</td>
                      <td className="admin-cell-muted">{t.previousCount}</td>
                      <td style={{ color: '#4caf50', fontWeight: 600 }}>+{t.change}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Declining Terms */}
        <div className="admin-detail-card">
          <h3>Declining Terms</h3>
          <p style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>Terms with the largest drop-off (last 7 days vs previous 7 days)</p>
          {decliningTerms.length === 0 ? (
            <p style={{ fontSize: 12, color: '#888', padding: '20px 0', textAlign: 'center' }}>
              {hasData ? 'No declining terms detected in this period' : 'No trend data yet — searches will be analyzed once enough data is collected.'}
            </p>
          ) : (
            <div className="admin-table-wrap" style={{ border: 'none', borderRadius: 0 }}>
              <table className="admin-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Term</th>
                    <th>This Week</th>
                    <th>Last Week</th>
                    <th>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {decliningTerms.map(t => (
                    <tr key={t.term}>
                      <td className="admin-cell-name">{t.term}</td>
                      <td>{t.currentCount}</td>
                      <td className="admin-cell-muted">{t.previousCount}</td>
                      <td style={{ color: '#f44336', fontWeight: 600 }}>{t.change}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="admin-detail-grid" style={{ marginTop: 16 }}>
        {/* Daily Search Activity */}
        <div className="admin-detail-card">
          <h3>Search Activity Over Time</h3>
          <p style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>Daily search count for the last 14 days</p>
          {!hasData ? (
            <p style={{ fontSize: 12, color: '#888', padding: '20px 0', textAlign: 'center' }}>No search data yet</p>
          ) : (
            <div style={{ marginTop: 12 }}>
              {dailyActivity.map(d => {
                const label = new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                return (
                  <div key={d.date} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: '#888', width: 55, flexShrink: 0 }}>{label}</span>
                    <div style={{ flex: 1, height: 16, background: 'rgba(128,128,128,0.06)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.round((d.count / maxDaily) * 100)}%`, height: '100%', background: '#4caf50', borderRadius: 4, transition: 'width 0.3s' }} />
                    </div>
                    <span style={{ fontSize: 11, color: '#666', width: 40, textAlign: 'right' }}>{d.count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Popular Filters */}
        <div className="admin-detail-card">
          <h3>Popular Filters</h3>
          <p style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>Search filter usage over the last 14 days</p>
          {filterCounts.length === 0 ? (
            <p style={{ fontSize: 12, color: '#888', padding: '20px 0', textAlign: 'center' }}>No search data yet</p>
          ) : (
            <div className="admin-table-wrap" style={{ border: 'none', borderRadius: 0 }}>
              <table className="admin-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Filter</th>
                    <th>Searches</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {filterCounts.map(f => (
                    <tr key={f.filter}>
                      <td className="admin-cell-name" style={{ textTransform: 'capitalize' }}>{f.filter}</td>
                      <td>{f.count}</td>
                      <td className="admin-cell-muted">{f.pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
