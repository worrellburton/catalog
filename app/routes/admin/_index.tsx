import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link } from '@remix-run/react';
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

type RangeId = 'daily' | 'monthly' | 'yearly';
type Audience = 'all' | 'users' | 'admins';

// All-time-since labels for the toggle. "Daily" = last 24h, "Monthly"
// = last 30d, "Yearly" = last 365d. The number rendered is computed
// over that window.
const RANGE_LABELS: Record<RangeId, string> = {
  daily: 'Daily',
  monthly: 'Monthly',
  yearly: 'Yearly',
};
const RANGE_WINDOWS_MS: Record<RangeId, number> = {
  daily: 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
  yearly: 365 * 24 * 60 * 60 * 1000,
};

const AUDIENCE_LABELS: Record<Audience, string> = {
  all: 'Users + Admins',
  users: 'Users only',
  admins: 'Admins only',
};

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

function formatNumber(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

/** Build the URL for a metric's detail page, preserving the current
 *  audience + range so the detail view opens with the same scope. */
function metricLink(id: string, audience: Audience, range: RangeId): string {
  const params = new URLSearchParams({ audience, range });
  return `/admin/metrics/${id}?${params.toString()}`;
}

function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '—';
  const m = ms / 60000;
  if (m < 1) return `${Math.round(ms / 1000)}s`;
  if (m < 60) return `${m.toFixed(1)}m`;
  const h = m / 60;
  return `${h.toFixed(1)}h`;
}

// ── Per-window aggregate shape ───────────────────────────────────
// Everything in this struct is scoped to the (audience, range) pair.
interface HomeStats {
  activeUsers: number | null;
  avgSessionMs: number | null;
  /** Average wall-clock time WITHIN a session where no events
   *  fired beyond the IDLE_THRESHOLD_MS gap. Sums every
   *  consecutive-event gap > IDLE_THRESHOLD_MS per session, then
   *  averages across sessions. The user "had the app open but
   *  wasn't interacting" portion of session length. */
  avgIdleMs: number | null;
  /** avgSession − avgIdle. The "actively engaging" portion of
   *  session length — fires-an-event-every-30s-or-less type time. */
  avgActiveMs: number | null;
  impressions: number | null;
  clicks: number | null;
  clickouts: number | null;
  conversionPct: number | null;
  productsAdded: number | null;
  looksUploaded: number | null;
  creatorsFollowed: number | null;
  newSignups: number | null;
  searches: number | null;
  aiGenerations: number | null;
}

// Anything longer than this between two consecutive events in a
// session counts as IDLE time (user walked away, switched tabs,
// looked at one product for ages without scrolling). 30s is a
// reasonable web-analytics default — short enough that genuine
// reading still counts as active, long enough that quick taps don't
// inflate idle.
const IDLE_THRESHOLD_MS = 30_000;

const EMPTY_STATS: HomeStats = {
  activeUsers: null,
  avgSessionMs: null,
  avgIdleMs: null,
  avgActiveMs: null,
  impressions: null,
  clicks: null,
  clickouts: null,
  conversionPct: null,
  productsAdded: null,
  looksUploaded: null,
  creatorsFollowed: null,
  newSignups: null,
  searches: null,
  aiGenerations: null,
};

export default function AdminHome() {
  // ── Filters ───────────────────────────────────────────────────
  const [range, setRange] = useState<RangeId>('daily');
  const [audience, setAudience] = useState<Audience>('all');

  // ── Aggregated stats for the active (audience, range) ─────────
  const [stats, setStats] = useState<HomeStats>(EMPTY_STATS);
  const [statsLoading, setStatsLoading] = useState(true);

  // ── Sections that don't depend on the toggles ─────────────────
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
        brand: r.product?.brand || ' - ',
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

  // ── Sticky sections (recent activity, top searches, weekly chart) ──
  // Extracted into a stable callback so both the initial load AND the
  // live-refresh poll below can re-run it.
  const loadSticky = useCallback(async () => {
    if (!supabase) return;
    const { data: recentLogs } = await supabase
      .from('search_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(6);
    setRecentActivity(recentLogs ?? []);

    const { data: allLogs } = await supabase
      .from('search_logs')
      .select('*')
      .order('created_at', { ascending: false });
    setAllSearchLogs(allLogs ?? []);

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
  }, []);
  useEffect(() => { void loadSticky(); }, [loadSticky]);

  // ── Window-scoped aggregates ──────────────────────────────────
  // Recomputes whenever the (audience, range) pair changes. Each
  // metric is its own query; counts run as head-only for speed.
  // Audience filters by profiles.is_admin via an IN-list of ids
  // resolved up front.
  // Window-scoped aggregate loader. `silent` skips the loading flash so the
  // live-refresh poll updates the numbers in place instead of blinking them
  // to "…". A monotonic request id guards against a slow earlier run (or
  // poll) overwriting a newer one.
  const statsReqRef = useRef(0);
  const loadStats = useCallback(async (silent = false) => {
    const myReq = ++statsReqRef.current;
    {
      if (!supabase) return;
      if (!silent) setStatsLoading(true);
      const now = Date.now();
      const startISO = new Date(now - RANGE_WINDOWS_MS[range]).toISOString();

      // 1) Resolve the user id set for the current audience filter.
      //    For "all" we skip the IN-list entirely (every user counts).
      let userIdsForAudience: string[] | null = null;
      if (audience !== 'all') {
        const q = supabase.from('profiles').select('id').limit(10_000);
        const filtered = audience === 'admins'
          ? q.eq('is_admin', true)
          : q.or('is_admin.is.null,is_admin.eq.false');
        const { data: ids } = await filtered;
        userIdsForAudience = (ids || []).map(r => r.id);
        // Avoid empty IN-lists (Postgrest returns an error) by short-
        // circuiting with a sentinel that never matches.
        if (userIdsForAudience.length === 0) userIdsForAudience = ['__none__'];
      }

      const eventBase = () => {
        let q = supabase!
          .from('user_events')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', startISO);
        if (userIdsForAudience) q = q.in('user_id', userIdsForAudience);
        return q;
      };

      const [
        activeRes,
        impRes,
        clickRes,
        clickoutRes,
        productsRes,
        looksRes,
        followsRes,
        signupsRes,
        searchesRes,
        gensRes,
        sessionRes,
      ] = await Promise.all([
        // Active users — distinct user_id in window.
        (async () => {
          let q = supabase!
            .from('user_events')
            .select('user_id')
            .gte('created_at', startISO)
            .not('user_id', 'is', null)
            .limit(50_000);
          if (userIdsForAudience) q = q.in('user_id', userIdsForAudience);
          const { data } = await q;
          const distinct = new Set((data || []).map(r => r.user_id));
          return distinct.size;
        })(),
        eventBase().eq('event_type', 'impression'),
        eventBase().eq('event_type', 'click'),
        eventBase().eq('event_type', 'clickout'),
        // Products added in window — products.created_at, no audience scope.
        supabase.from('products').select('*', { count: 'exact', head: true }).gte('created_at', startISO),
        // Looks uploaded — user_generations.created_at, scoped to audience.
        (async () => {
          let q = supabase!.from('user_generations').select('*', { count: 'exact', head: true }).gte('created_at', startISO);
          if (userIdsForAudience) q = q.in('user_id', userIdsForAudience);
          return q;
        })(),
        // Creators followed — creator_follows in window, scoped to audience.
        (async () => {
          let q = supabase!.from('creator_follows').select('*', { count: 'exact', head: true }).gte('created_at', startISO);
          if (userIdsForAudience) q = q.in('user_id', userIdsForAudience);
          return q;
        })(),
        // New signups — profiles.created_at, scoped to audience.
        (async () => {
          let q = supabase!.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', startISO);
          if (audience === 'admins') q = q.eq('is_admin', true);
          if (audience === 'users') q = q.or('is_admin.is.null,is_admin.eq.false');
          return q;
        })(),
        // Search queries — search_logs in window.
        supabase.from('search_logs').select('*', { count: 'exact', head: true }).gte('created_at', startISO),
        // AI generations — user_generations.created_at + status indicates a real generation.
        (async () => {
          let q = supabase!.from('user_generations').select('*', { count: 'exact', head: true }).gte('created_at', startISO);
          if (userIdsForAudience) q = q.in('user_id', userIdsForAudience);
          return q;
        })(),
        // Session length + idle + active. Three numbers from the same
        // walk over events grouped by session_id:
        //   • session length = max(t) − min(t) per session
        //   • idle           = Σ (gap between consecutive events) for
        //                      gaps > IDLE_THRESHOLD_MS
        //   • active         = session length − idle
        // Returns averages across all sessions in the window. Pulled
        // raw (not head-only) because head-counts can't aggregate
        // per-session.
        (async () => {
          let q = supabase!
            .from('user_events')
            .select('session_id, created_at')
            .gte('created_at', startISO)
            .not('session_id', 'is', null)
            .order('created_at', { ascending: true })
            .limit(20_000);
          if (userIdsForAudience) q = q.in('user_id', userIdsForAudience);
          const { data } = await q;
          // Bucket timestamps per session_id, sorted asc (the query's
          // order:asc preserves global order, but we sort inside the
          // bucket anyway in case PostgREST reorders).
          const bySession = new Map<string, number[]>();
          (data || []).forEach(r => {
            const t = new Date(r.created_at).getTime();
            const arr = bySession.get(r.session_id) || [];
            arr.push(t);
            bySession.set(r.session_id, arr);
          });
          if (bySession.size === 0) return { sessionMs: 0, idleMs: 0, activeMs: 0 };
          let totalSession = 0;
          let totalIdle = 0;
          let n = 0;
          for (const arr of bySession.values()) {
            if (arr.length < 2) continue; // single-event sessions skipped
            arr.sort((a, b) => a - b);
            const sessionMs = arr[arr.length - 1] - arr[0];
            if (sessionMs <= 0) continue;
            let idleMs = 0;
            for (let i = 1; i < arr.length; i++) {
              const gap = arr[i] - arr[i - 1];
              if (gap > IDLE_THRESHOLD_MS) idleMs += gap;
            }
            totalSession += sessionMs;
            totalIdle += idleMs;
            n++;
          }
          if (n === 0) return { sessionMs: 0, idleMs: 0, activeMs: 0 };
          const avgSession = Math.round(totalSession / n);
          const avgIdle = Math.round(totalIdle / n);
          return {
            sessionMs: avgSession,
            idleMs: avgIdle,
            activeMs: Math.max(0, avgSession - avgIdle),
          };
        })(),
      ]);

      if (myReq !== statsReqRef.current) return;

      const impressions = impRes.count ?? 0;
      const clicks = clickRes.count ?? 0;
      const clickouts = clickoutRes.count ?? 0;
      const conversion = clicks > 0 ? (clickouts / clicks) * 100 : 0;

      setStats({
        activeUsers: activeRes,
        avgSessionMs: sessionRes.sessionMs,
        avgIdleMs: sessionRes.idleMs,
        avgActiveMs: sessionRes.activeMs,
        impressions,
        clicks,
        clickouts,
        conversionPct: Number(conversion.toFixed(1)),
        productsAdded: productsRes.count ?? 0,
        looksUploaded: looksRes.count ?? 0,
        creatorsFollowed: followsRes.count ?? 0,
        newSignups: signupsRes.count ?? 0,
        searches: searchesRes.count ?? 0,
        aiGenerations: gensRes.count ?? 0,
      });
      if (myReq === statsReqRef.current) setStatsLoading(false);
    }
  }, [range, audience]);
  // Initial load + re-run whenever the (audience, range) scope changes.
  useEffect(() => { void loadStats(false); }, [loadStats]);

  // ── Live refresh ──────────────────────────────────────────────
  // While the dashboard is open and the tab is visible, silently re-pull
  // the aggregates + sticky sections every 10s so the numbers move in real
  // time. Paused when the tab is hidden; an immediate refresh fires when it
  // becomes visible again so a backgrounded tab catches up instantly.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const REFRESH_MS = 10_000;
    let intervalId = 0;
    const refresh = () => { void loadStats(true); void loadSticky(); };
    const start = () => { if (!intervalId) intervalId = window.setInterval(refresh, REFRESH_MS); };
    const stop = () => { if (intervalId) { window.clearInterval(intervalId); intervalId = 0; } };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { refresh(); start(); }
      else stop();
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [loadStats, loadSticky]);

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

  const activeLabel: Record<RangeId, string> = {
    daily: 'Daily active users',
    monthly: 'Monthly active users',
    yearly: 'Yearly active users',
  };

  // Local seed counts for reference
  const creatorsCount = Object.keys(creators).length;
  const looksCount = looks.length;

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Home</h1>
        <p className="admin-page-subtitle">Platform overview</p>
      </div>

      {/* Filter toggle row — Audience + Range. Single row on desktop,
          stacked on mobile (see .admin-home-filters CSS). */}
      <div className="admin-home-filters" role="toolbar" aria-label="Home filters">
        <div className="admin-home-filter-group" role="tablist" aria-label="Audience">
          {(Object.keys(AUDIENCE_LABELS) as Audience[]).map(a => (
            <button
              key={a}
              type="button"
              role="tab"
              aria-selected={audience === a}
              className={`admin-home-filter-pill${audience === a ? ' is-active' : ''}`}
              onClick={() => setAudience(a)}
            >{AUDIENCE_LABELS[a]}</button>
          ))}
        </div>
        <div className="admin-home-filter-group" role="tablist" aria-label="Time range">
          {(Object.keys(RANGE_LABELS) as RangeId[]).map(r => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={range === r}
              className={`admin-home-filter-pill${range === r ? ' is-active' : ''}`}
              onClick={() => setRange(r)}
            >{RANGE_LABELS[r]}</button>
          ))}
        </div>
      </div>

      {/* Window-scoped stats grid. Mobile collapses to 2 columns,
          desktop is 4. Each card shows label + big number + a small
          secondary metric where useful. */}
      <div className="admin-home-stats">
        {/* Each card links to /admin/metrics/<id>?audience=…&range=…
            so the detail view opens with the same scope the shopper
            was just looking at. metricLink keeps the URL params in
            sync without sprinkling them at every callsite. */}
        {(() => null)()}
        <StatCard
          icon={<UserIcon />}
          label={activeLabel[range]}
          value={formatNumber(stats.activeUsers)}
          loading={statsLoading}
          to={metricLink('active-users', audience, range)}
        />
        <StatCard
          icon={<ClockIcon />}
          label="Avg session"
          value={stats.avgSessionMs != null ? formatDuration(stats.avgSessionMs) : '—'}
          sub={stats.avgSessionMs && stats.avgActiveMs != null
            ? `${Math.round((stats.avgActiveMs / Math.max(stats.avgSessionMs, 1)) * 100)}% active`
            : undefined}
          loading={statsLoading}
          to={metricLink('avg-session', audience, range)}
        />
        <StatCard
          icon={<ClockIcon />}
          label="Avg idle"
          value={stats.avgIdleMs != null ? formatDuration(stats.avgIdleMs) : '—'}
          loading={statsLoading}
          to={metricLink('avg-idle', audience, range)}
        />
        <StatCard
          icon={<ClockIcon />}
          label="Avg active"
          value={stats.avgActiveMs != null ? formatDuration(stats.avgActiveMs) : '—'}
          loading={statsLoading}
          to={metricLink('avg-active', audience, range)}
        />
        <StatCard
          icon={<EyeIcon />}
          label="Impressions"
          value={formatNumber(stats.impressions)}
          loading={statsLoading}
          to={metricLink('impressions', audience, range)}
        />
        <StatCard
          icon={<CursorIcon />}
          label="Clicks"
          value={formatNumber(stats.clicks)}
          sub={stats.impressions && stats.clicks ? `${((stats.clicks / stats.impressions) * 100).toFixed(1)}% CTR` : undefined}
          loading={statsLoading}
          to={metricLink('clicks', audience, range)}
        />
        <StatCard
          icon={<ExternalIcon />}
          label="Clickouts"
          value={formatNumber(stats.clickouts)}
          sub={stats.conversionPct != null ? `${stats.conversionPct}% of clicks` : undefined}
          loading={statsLoading}
          to={metricLink('clickouts', audience, range)}
        />
        <StatCard
          icon={<PackageIcon />}
          label="Products added"
          value={formatNumber(stats.productsAdded)}
          loading={statsLoading}
          to={metricLink('products-added', audience, range)}
        />
        <StatCard
          icon={<ImageIcon />}
          label="Looks uploaded"
          value={formatNumber(stats.looksUploaded)}
          loading={statsLoading}
          to={metricLink('looks-uploaded', audience, range)}
        />
        <StatCard
          icon={<HeartIcon />}
          label="Creator follows"
          value={formatNumber(stats.creatorsFollowed)}
          loading={statsLoading}
          to={metricLink('creator-follows', audience, range)}
        />
        <StatCard
          icon={<UserPlusIcon />}
          label="New signups"
          value={formatNumber(stats.newSignups)}
          loading={statsLoading}
          to={metricLink('new-signups', audience, range)}
        />
        <StatCard
          icon={<SearchIcon />}
          label="Searches"
          value={formatNumber(stats.searches)}
          loading={statsLoading}
          to={metricLink('searches', audience, range)}
        />
        <StatCard
          icon={<SparkleIcon />}
          label="AI generations"
          value={formatNumber(stats.aiGenerations)}
          loading={statsLoading}
          to={metricLink('ai-generations', audience, range)}
        />
        <StatCard
          icon={<TrendIcon />}
          label="Catalog totals"
          value={`${creatorsCount} creators`}
          sub={`${looksCount.toLocaleString()} seed looks`}
          loading={false}
          to="/admin/creators"
        />
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
    </div>
  );
}

// ── Tiny presentational helpers ─────────────────────────────────
function StatCard({ icon, label, value, sub, loading, to }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  loading?: boolean;
  /** When set, the card becomes a link to the metric detail page —
   *  /admin/metrics/<id>. Preserves the audience + range query string
   *  so the detail view opens with the same filters. */
  to?: string;
}) {
  const body = (
    <>
      <div className="admin-home-stat-icon">{icon}</div>
      <div className="admin-home-stat-label">{label}</div>
      <div className={`admin-home-stat-value${loading ? ' is-loading' : ''}`}>
        {loading ? '…' : value}
      </div>
      {sub && <div className="admin-home-stat-sub">{sub}</div>}
    </>
  );
  if (to) {
    // Remix Link → client-side nav. A plain <a href> did a hard reload of
    // the SPA, which inside the admin shell could drop state or 404 on the
    // static host's deep-route fallback — that's why some cards "didn't go
    // anywhere". Link keeps it in-app so every card reaches its page.
    return (
      <Link
        to={to}
        className="admin-home-stat-card admin-home-stat-card--link"
      >{body}</Link>
    );
  }
  return <div className="admin-home-stat-card">{body}</div>;
}

function UserIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>; }
function UserPlusIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>; }
function ClockIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>; }
function EyeIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>; }
function CursorIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg>; }
function ExternalIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>; }
function PackageIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>; }
function ImageIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>; }
function HeartIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>; }
function SearchIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>; }
function SparkleIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 14 9 21 12 14 15 12 22 10 15 3 12 10 9z"/></svg>; }
function TrendIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>; }
