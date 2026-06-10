// /admin/metrics/<id> — drill-down detail for any home stat card.
// Mirrors the home's audience + range toggles, shows the same scoped
// number, and renders a 30-bucket time-series chart so trends are
// visible. Some metrics also surface a "top contributors" list
// (top products by impressions, top searched terms, etc.) when one
// makes sense.

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, Link } from '@remix-run/react';
import { supabase } from '~/utils/supabase';

// ── Toggles (mirror the home page) ──────────────────────────────
type RangeId = 'daily' | 'monthly' | 'yearly';
type Audience = 'all' | 'users' | 'admins';
const RANGE_LABELS: Record<RangeId, string> = { daily: 'Daily', monthly: 'Monthly', yearly: 'Yearly' };
const RANGE_WINDOWS_MS: Record<RangeId, number> = {
  daily: 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
  yearly: 365 * 24 * 60 * 60 * 1000,
};
const AUDIENCE_LABELS: Record<Audience, string> = {
  all: 'Users + Admins', users: 'Users only', admins: 'Admins only',
};
const RANGE_ORDER: RangeId[] = ['daily','monthly','yearly'];
const AUDIENCE_ORDER: Audience[] = ['all','users','admins'];

// ── Metric registry ────────────────────────────────────────────
// Source-of-truth for the title, the unit, and the query function
// each card runs in detail mode. The query gets a (range, audience)
// pair and returns the headline number + a time-series + an
// optional contributors list.
interface MetricResult {
  /** The single big number rendered at the top — already formatted. */
  value: string;
  /** A 30-point series of { label, count } — labels render on the X
   *  axis, counts drive the bar heights. */
  series: { label: string; count: number }[];
  /** Optional ranked list shown below the chart. */
  contributors?: { label: string; sub?: string; count: number }[];
}

interface MetricDef {
  id: string;
  title: string;
  description: string;
  /** "events" / "users" / "products" — drives the count label. */
  unit: string;
  /** Heading for the optional contributors list (defaults to "Top contributors"). */
  contributorsTitle?: string;
  run(args: { startISO: string; userIdSet: string[] | null; bucketMs: number; buckets: { startISO: string; endISO: string; label: string }[] }): Promise<MetricResult>;
}

// ── Helpers ────────────────────────────────────────────────────
function formatNumber(n: number | null): string {
  if (n === null || n === undefined) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '—';
  const m = ms / 60000;
  if (m < 1) return `${Math.round(ms / 1000)}s`;
  if (m < 60) return `${m.toFixed(1)}m`;
  return `${(m / 60).toFixed(1)}h`;
}

/** "just now" / "12m ago" / "3h ago" / "2d ago" for a past-elapsed span. */
function formatAgo(ms: number): string {
  if (ms < 60_000) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Build N evenly-spaced time buckets covering the active range. */
function buildBuckets(rangeMs: number): { startISO: string; endISO: string; label: string; t: number }[] {
  const now = Date.now();
  const start = now - rangeMs;
  // 30 buckets across the window — daily ≈ 48min slices; monthly ≈
  // daily; yearly ≈ 12-day slices.
  const N = 30;
  const slice = Math.floor(rangeMs / N);
  const out: { startISO: string; endISO: string; label: string; t: number }[] = [];
  for (let i = 0; i < N; i++) {
    const s = start + i * slice;
    const e = i === N - 1 ? now : s + slice;
    let label = '';
    const d = new Date(s);
    if (rangeMs <= 26 * 60 * 60 * 1000) label = `${d.getHours()}h`;
    else if (rangeMs <= 32 * 24 * 60 * 60 * 1000) label = `${d.getMonth() + 1}/${d.getDate()}`;
    else label = `${d.getMonth() + 1}/${d.getFullYear() % 100}`;
    out.push({ startISO: new Date(s).toISOString(), endISO: new Date(e).toISOString(), label, t: s });
  }
  return out;
}

// ── Generic event-bucketing query for impressions/clicks/clickouts/searches ──
async function countEventsByBucket(args: {
  buckets: { startISO: string; endISO: string; label: string }[];
  eventType: string;
  targetType?: string;
  table?: 'user_events' | 'search_logs';
  userIdSet: string[] | null;
}): Promise<MetricResult> {
  if (!supabase) return { value: '—', series: [] };
  const supa = supabase;
  const table = args.table || 'user_events';
  const total = args.buckets[0]?.startISO || new Date(0).toISOString();
  // Pull EVERY row inside the window once, then bucket in JS — one
  // round trip beats 30 head-counts.
  let q = supa.from(table).select('created_at').gte('created_at', total).limit(50_000);
  if (table === 'user_events' && args.eventType) q = q.eq('event_type', args.eventType);
  if (table === 'user_events' && args.targetType) q = q.eq('target_type', args.targetType);
  if (args.userIdSet && table === 'user_events') q = q.in('user_id', args.userIdSet);
  const { data } = await q;
  const rows = (data || []).map(r => new Date(r.created_at).getTime());
  const series = args.buckets.map(b => {
    const s = new Date(b.startISO).getTime();
    const e = new Date(b.endISO).getTime();
    const count = rows.filter(t => t >= s && t < e).length;
    return { label: b.label, count };
  });
  const total_ = series.reduce((a, b) => a + b.count, 0);
  return { value: formatNumber(total_), series };
}

// ── Specific implementations ────────────────────────────────────
async function activeUsers(args: { buckets: { startISO: string; endISO: string; label: string }[]; userIdSet: string[] | null }): Promise<MetricResult> {
  if (!supabase) return { value: '—', series: [] };
  const supa = supabase;
  const total = args.buckets[0]?.startISO || new Date(0).toISOString();
  // Pull session_id too so we can compute per-user active time (the same
  // wall-clock-minus-idle model the session metrics use).
  let q = supa.from('user_events').select('user_id, session_id, created_at').gte('created_at', total).not('user_id', 'is', null).limit(50_000);
  if (args.userIdSet) q = q.in('user_id', args.userIdSet);
  const { data } = await q;
  const rows = (data || []) as { user_id: string; session_id: string | null; created_at: string }[];
  const distinctOverall = new Set(rows.map(r => r.user_id));
  const series = args.buckets.map(b => {
    const s = new Date(b.startISO).getTime();
    const e = new Date(b.endISO).getTime();
    const set = new Set(rows.filter(r => {
      const t = new Date(r.created_at).getTime();
      return t >= s && t < e;
    }).map(r => r.user_id));
    return { label: b.label, count: set.size };
  });

  // ── Per-user roll-up: who was on, their active session time + stats ──
  type Agg = { events: number; sessions: Map<string, number[]>; lastSeen: number };
  const byUser = new Map<string, Agg>();
  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    let a = byUser.get(r.user_id);
    if (!a) { a = { events: 0, sessions: new Map(), lastSeen: 0 }; byUser.set(r.user_id, a); }
    a.events++;
    if (t > a.lastSeen) a.lastSeen = t;
    const sid = r.session_id || '__nosession__';
    const arr = a.sessions.get(sid) || [];
    arr.push(t);
    a.sessions.set(sid, arr);
  }
  const userStats = Array.from(byUser.entries()).map(([userId, a]) => {
    let activeMs = 0;
    for (const arr of a.sessions.values()) {
      if (arr.length < 2) continue;
      arr.sort((x, y) => x - y);
      const sessionMs = arr[arr.length - 1] - arr[0];
      if (sessionMs <= 0) continue;
      let idleMs = 0;
      for (let j = 1; j < arr.length; j++) {
        const gap = arr[j] - arr[j - 1];
        if (gap > IDLE_THRESHOLD_MS) idleMs += gap;
      }
      activeMs += Math.max(0, sessionMs - idleMs);
    }
    return { userId, events: a.events, sessions: a.sessions.size, activeMs, lastSeen: a.lastSeen };
  });
  // Most-engaged first (active time, then raw events). Cap the list so the
  // profiles lookup stays one bounded round-trip.
  userStats.sort((x, y) => y.activeMs - x.activeMs || y.events - x.events);
  const top = userStats.slice(0, 50);

  // Resolve display names for the listed users in one query.
  const nameById = new Map<string, { name: string; isAdmin: boolean }>();
  if (top.length > 0) {
    const { data: profs } = await supa
      .from('profiles')
      .select('id, full_name, email, is_admin')
      .in('id', top.map(u => u.userId));
    for (const p of (profs || []) as { id: string; full_name: string | null; email: string | null; is_admin: boolean | null }[]) {
      nameById.set(p.id, { name: p.full_name || p.email || `User ${p.id.slice(0, 8)}`, isAdmin: !!p.is_admin });
    }
  }
  const now = Date.now();
  const contributors = top.map(u => {
    const prof = nameById.get(u.userId);
    const name = prof?.name || `User ${u.userId.slice(0, 8)}`;
    const adminTag = prof?.isAdmin ? ' · admin' : '';
    const sub = `${formatDuration(u.activeMs)} active · ${u.sessions} session${u.sessions === 1 ? '' : 's'} · last seen ${formatAgo(now - u.lastSeen)}${adminTag}`;
    return { label: name, sub, count: u.events };
  });

  return { value: formatNumber(distinctOverall.size), series, contributors };
}

async function countCreatedByBucket(args: {
  table: string;
  buckets: { startISO: string; endISO: string; label: string }[];
  scopeColumn?: 'user_id';
  userIdSet?: string[] | null;
  isAdminFilter?: 'admins' | 'users' | null;
}): Promise<MetricResult> {
  if (!supabase) return { value: '—', series: [] };
  const supa = supabase;
  const total = args.buckets[0]?.startISO || new Date(0).toISOString();
  let q = supa.from(args.table).select('created_at').gte('created_at', total).limit(50_000);
  if (args.scopeColumn === 'user_id' && args.userIdSet) q = q.in('user_id', args.userIdSet);
  if (args.isAdminFilter === 'admins') q = q.eq('is_admin', true);
  if (args.isAdminFilter === 'users') q = q.or('is_admin.is.null,is_admin.eq.false');
  const { data } = await q;
  const rows = (data || []).map(r => new Date(r.created_at).getTime());
  const series = args.buckets.map(b => {
    const s = new Date(b.startISO).getTime();
    const e = new Date(b.endISO).getTime();
    return { label: b.label, count: rows.filter(t => t >= s && t < e).length };
  });
  return { value: formatNumber(rows.length), series };
}

const METRICS: Record<string, MetricDef> = {
  'active-users': {
    id: 'active-users', title: 'Active users', unit: 'users',
    description: 'Distinct users who fired at least one event in the window.',
    contributorsTitle: 'Who was on · active time + stats',
    run: ({ buckets, userIdSet }) => activeUsers({ buckets, userIdSet }),
  },
  'avg-session': {
    id: 'avg-session', title: 'Avg session length', unit: 'sessions',
    description: 'Mean wall-clock min→max per session_id.',
    run: async ({ buckets, userIdSet }) => sessionStats(buckets, userIdSet, 'session'),
  },
  'avg-idle': {
    id: 'avg-idle', title: 'Avg idle time', unit: 'sessions',
    description: 'Sum of gaps >30s between consecutive events per session, averaged.',
    run: async ({ buckets, userIdSet }) => sessionStats(buckets, userIdSet, 'idle'),
  },
  'avg-active': {
    id: 'avg-active', title: 'Avg active time', unit: 'sessions',
    description: 'Avg session − Avg idle. Genuine engagement time.',
    run: async ({ buckets, userIdSet }) => sessionStats(buckets, userIdSet, 'active'),
  },
  'impressions': {
    id: 'impressions', title: 'Impressions', unit: 'events',
    description: 'Look + product impression events.',
    run: ({ buckets, userIdSet }) => countEventsByBucket({ buckets, eventType: 'impression', userIdSet }),
  },
  'clicks': {
    id: 'clicks', title: 'Clicks', unit: 'events',
    description: 'Click events on looks and products.',
    run: ({ buckets, userIdSet }) => countEventsByBucket({ buckets, eventType: 'click', userIdSet }),
  },
  'clickouts': {
    id: 'clickouts', title: 'Clickouts', unit: 'events',
    description: 'Outbound clicks to product retailer URLs.',
    run: ({ buckets, userIdSet }) => countEventsByBucket({ buckets, eventType: 'clickout', userIdSet }),
  },
  'products-added': {
    id: 'products-added', title: 'Products added', unit: 'products',
    description: 'New rows in the products table.',
    run: ({ buckets }) => countCreatedByBucket({ table: 'products', buckets }),
  },
  'looks-uploaded': {
    id: 'looks-uploaded', title: 'Looks uploaded', unit: 'looks',
    description: 'New rows in user_generations.',
    run: ({ buckets, userIdSet }) =>
      countCreatedByBucket({ table: 'user_generations', buckets, scopeColumn: 'user_id', userIdSet }),
  },
  'creator-follows': {
    id: 'creator-follows', title: 'Creator follows', unit: 'follows',
    description: 'New rows in creator_follows.',
    run: ({ buckets, userIdSet }) =>
      countCreatedByBucket({ table: 'creator_follows', buckets, scopeColumn: 'user_id', userIdSet }),
  },
  'new-signups': {
    id: 'new-signups', title: 'New signups', unit: 'profiles',
    description: 'New rows in profiles, scoped to the active audience.',
    run: ({ buckets }) =>
      countCreatedByBucket({ table: 'profiles', buckets }),
  },
  'searches': {
    id: 'searches', title: 'Searches', unit: 'queries',
    description: 'Rows in search_logs.',
    run: ({ buckets }) => countEventsByBucket({ buckets, eventType: '', table: 'search_logs', userIdSet: null }),
  },
  'ai-generations': {
    id: 'ai-generations', title: 'AI generations', unit: 'generations',
    description: 'New rows in user_generations (every generation request counts).',
    run: ({ buckets, userIdSet }) =>
      countCreatedByBucket({ table: 'user_generations', buckets, scopeColumn: 'user_id', userIdSet }),
  },
};

// ── Session stats — shared by avg-session / avg-idle / avg-active ─
const IDLE_THRESHOLD_MS = 30_000;
async function sessionStats(
  buckets: { startISO: string; endISO: string; label: string }[],
  userIdSet: string[] | null,
  pick: 'session' | 'idle' | 'active',
): Promise<MetricResult> {
  if (!supabase) return { value: '—', series: [] };
  const supa = supabase;
  const total = buckets[0]?.startISO || new Date(0).toISOString();
  let q = supa.from('user_events').select('session_id, created_at')
    .gte('created_at', total).not('session_id', 'is', null)
    .order('created_at', { ascending: true }).limit(20_000);
  if (userIdSet) q = q.in('user_id', userIdSet);
  const { data } = await q;
  // Group by (bucket, session) → sorted timestamps.
  const byBucketSession: Map<string, number[]>[] = buckets.map(() => new Map());
  let overallTotalSession = 0;
  let overallTotalIdle = 0;
  let overallN = 0;
  (data || []).forEach(r => {
    const t = new Date(r.created_at).getTime();
    const idx = buckets.findIndex(b => t >= new Date(b.startISO).getTime() && t < new Date(b.endISO).getTime());
    if (idx < 0) return;
    const arr = byBucketSession[idx].get(r.session_id) || [];
    arr.push(t);
    byBucketSession[idx].set(r.session_id, arr);
  });
  const series = buckets.map((b, i) => {
    let bucketTotal = 0;
    let bucketN = 0;
    for (const arr of byBucketSession[i].values()) {
      if (arr.length < 2) continue;
      arr.sort((a, b2) => a - b2);
      const sessionMs = arr[arr.length - 1] - arr[0];
      if (sessionMs <= 0) continue;
      let idleMs = 0;
      for (let j = 1; j < arr.length; j++) {
        const gap = arr[j] - arr[j - 1];
        if (gap > IDLE_THRESHOLD_MS) idleMs += gap;
      }
      const value = pick === 'session' ? sessionMs : pick === 'idle' ? idleMs : Math.max(0, sessionMs - idleMs);
      bucketTotal += value;
      bucketN++;
      overallTotalSession += sessionMs;
      overallTotalIdle += idleMs;
      overallN++;
    }
    // Series count is in MINUTES so bars are readable. Stored as
    // "count" because the chart only knows about numbers — the
    // label below the chart adds the unit.
    return { label: b.label, count: bucketN > 0 ? Math.round((bucketTotal / bucketN) / 60_000) : 0 };
  });
  if (overallN === 0) return { value: '—', series };
  const avgSession = Math.round(overallTotalSession / overallN);
  const avgIdle = Math.round(overallTotalIdle / overallN);
  const headline = pick === 'session' ? avgSession : pick === 'idle' ? avgIdle : Math.max(0, avgSession - avgIdle);
  return { value: formatDuration(headline), series };
}

// ── Page component ─────────────────────────────────────────────
export default function AdminMetricDetail() {
  const params = useParams();
  const id = params.id || '';
  const metric = METRICS[id];

  const [search, setSearch] = useSearchParams();
  const range = (search.get('range') as RangeId) || 'daily';
  const audience = (search.get('audience') as Audience) || 'all';
  const setRange = (r: RangeId) => setSearch(prev => { const n = new URLSearchParams(prev); n.set('range', r); return n; });
  const setAudience = (a: Audience) => setSearch(prev => { const n = new URLSearchParams(prev); n.set('audience', a); return n; });

  const [result, setResult] = useState<MetricResult | null>(null);
  const [loading, setLoading] = useState(true);

  const buckets = useMemo(() => buildBuckets(RANGE_WINDOWS_MS[range]).map(b => ({ startISO: b.startISO, endISO: b.endISO, label: b.label })), [range]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!metric || !supabase) { setLoading(false); return; }
      setLoading(true);
      // Resolve audience → user id set (same logic as the home page).
      let userIdSet: string[] | null = null;
      if (audience !== 'all') {
        const q = supabase.from('profiles').select('id').limit(10_000);
        const f = audience === 'admins' ? q.eq('is_admin', true) : q.or('is_admin.is.null,is_admin.eq.false');
        const { data: ids } = await f;
        userIdSet = (ids || []).map(r => r.id);
        if (userIdSet.length === 0) userIdSet = ['__none__'];
      }
      const res = await metric.run({
        startISO: buckets[0].startISO,
        userIdSet,
        bucketMs: RANGE_WINDOWS_MS[range] / 30,
        buckets,
      });
      if (cancelled) return;
      setResult(res);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [metric, audience, range, buckets]);

  if (!metric) {
    return (
      <div className="admin-page">
        <div className="admin-page-header">
          <h1>Metric not found</h1>
          <p className="admin-page-subtitle"><Link to="/admin">← Back to home</Link></p>
        </div>
      </div>
    );
  }

  const maxBar = Math.max(...(result?.series || []).map(s => s.count), 1);

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>{metric.title}</h1>
        <p className="admin-page-subtitle">
          <Link to="/admin">← Home</Link> · {metric.description}
        </p>
      </div>

      <div className="admin-home-filters" role="toolbar" aria-label="Filters">
        <div className="admin-home-filter-group" role="tablist" aria-label="Audience">
          {AUDIENCE_ORDER.map(a => (
            <button key={a} type="button" role="tab" aria-selected={audience === a}
              className={`admin-home-filter-pill${audience === a ? ' is-active' : ''}`}
              onClick={() => setAudience(a)}>{AUDIENCE_LABELS[a]}</button>
          ))}
        </div>
        <div className="admin-home-filter-group" role="tablist" aria-label="Time range">
          {RANGE_ORDER.map(r => (
            <button key={r} type="button" role="tab" aria-selected={range === r}
              className={`admin-home-filter-pill${range === r ? ' is-active' : ''}`}
              onClick={() => setRange(r)}>{RANGE_LABELS[r]}</button>
          ))}
        </div>
      </div>

      <div className="admin-metric-headline">
        <div className="admin-metric-headline-label">
          {RANGE_LABELS[range]} · {AUDIENCE_LABELS[audience]}
        </div>
        <div className={`admin-metric-headline-value${loading ? ' is-loading' : ''}`}>
          {loading ? '…' : (result?.value ?? '—')}
        </div>
        <div className="admin-metric-headline-unit">{metric.unit}</div>
      </div>

      <div className="admin-metric-chart-card">
        <h3 className="admin-home-card-title">Over time</h3>
        <div className="admin-metric-chart">
          {(result?.series || []).map((b, i) => (
            <div key={i} className="admin-metric-bar-col" title={`${b.label}: ${b.count}`}>
              <div className="admin-metric-bar" style={{ height: `${(b.count / maxBar) * 100}%` }} />
              {i % 5 === 0 && <span className="admin-metric-bar-label">{b.label}</span>}
            </div>
          ))}
        </div>
      </div>

      {result?.contributors && result.contributors.length > 0 && (
        <div className="admin-metric-list-card">
          <h3 className="admin-home-card-title">{metric.contributorsTitle || 'Top contributors'}</h3>
          <ol className="admin-metric-list">
            {result.contributors.map((c, i) => (
              <li key={i} className="admin-metric-list-row">
                <span className="admin-metric-list-rank">{i + 1}</span>
                <span className="admin-metric-list-name">
                  <span>{c.label}</span>
                  {c.sub && <span className="admin-metric-list-sub">{c.sub}</span>}
                </span>
                <span className="admin-metric-list-count">{c.count.toLocaleString()}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
