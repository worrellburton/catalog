import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from '@remix-run/react';
import {
  getUserAnalytics,
  getProductAnalytics,
  clickThroughRate,
  clickoutRate,
  formatDurationMs,
  type UserAnalyticsRow,
  type ProductAnalyticsRow,
} from '~/services/analytics';
import { supabase } from '~/utils/supabase';

/** Subscribe to realtime changes on the named tables and return a
 *  cleanup. Calls `onChange` with a debounced ~400ms trailing edge
 *  so an event burst (multiple impressions in a single scroll) does
 *  one re-fetch instead of a dozen. Also pings `onPulse` immediately
 *  so the "Live" indicator can flash in real time. */
function subscribeAnalytics(
  tables: string[],
  onChange: () => void,
  onPulse: () => void,
): () => void {
  if (!supabase) return () => {};
  let timer: number | null = null;
  const schedule = () => {
    onPulse();
    if (timer != null) window.clearTimeout(timer);
    timer = window.setTimeout(() => { timer = null; onChange(); }, 400);
  };
  const channel = supabase.channel(`analytics:${tables.join('+')}`);
  tables.forEach(table => {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      schedule,
    );
  });
  channel.subscribe();
  return () => {
    if (timer != null) window.clearTimeout(timer);
    void supabase.removeChannel(channel);
  };
}

/** Tiny pulse animation when a realtime event lands. The component
 *  toggles a class for ~1.2s; CSS handles the visual. */
function useLivePulse(): { live: boolean; pulse: () => void } {
  const [live, setLive] = useState(false);
  const timer = useRef<number | null>(null);
  const pulse = useCallback(() => {
    setLive(true);
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setLive(false), 1200);
  }, []);
  return { live, pulse };
}

function LiveChip({ live }: { live: boolean }) {
  return (
    <span className={`admin-live-chip${live ? ' is-live' : ''}`} aria-live="polite">
      <span className="admin-live-dot" aria-hidden="true" />
      Live
    </span>
  );
}

type Tab = 'users' | 'products';
const TAB_VALUES: readonly Tab[] = ['users', 'products'];
function isTab(v: string | null): v is Tab {
  return v !== null && (TAB_VALUES as readonly string[]).includes(v);
}

export default function AdminAnalytics() {
  // Sub-tab → URL pattern matches /admin/users (?tab=…). Default is
  // Users since that's the only tab with real data today; Products is
  // a stub placeholder until per-product analytics land.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = isTab(searchParams.get('tab')) ? (searchParams.get('tab') as Tab) : 'users';
  const setTab = useCallback((next: Tab) => {
    setSearchParams(prev => {
      const out = new URLSearchParams(prev);
      if (next === 'users') out.delete('tab');
      else                  out.set('tab', next);
      return out;
    }, { replace: false });
  }, [setSearchParams]);

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Analytics</h1>
        <p className="admin-page-subtitle">Per-user engagement and per-product performance</p>
      </div>
      <div className="admin-tabs">
        <button className={`admin-tab ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>
          Users
        </button>
        <button className={`admin-tab ${tab === 'products' ? 'active' : ''}`} onClick={() => setTab('products')}>
          Products
        </button>
      </div>

      {tab === 'users' && <UsersAnalyticsTable />}
      {tab === 'products' && <ProductsAnalyticsStub />}
    </div>
  );
}

// ── Users tab ────────────────────────────────────────────────────────────────

type SortKey =
  | 'name' | 'last_sign_in_at' | 'sign_in_count'
  | 'impressions' | 'clicks' | 'clickouts'
  | 'ctr_click' | 'ctr_clickout'
  | 'total_session' | 'avg_session' | 'idle_session';

function UsersAnalyticsTable() {
  const [rows, setRows] = useState<UserAnalyticsRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('last_sign_in_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const { live, pulse } = useLivePulse();

  useEffect(() => {
    let cancelled = false;
    const refetch = () => {
      getUserAnalytics().then(data => {
        if (cancelled) return;
        setRows(data);
        setLoaded(true);
      });
    };
    refetch();
    // Realtime: any insert/update on user_sessions or user_events
    // pulses the Live chip and triggers a debounced re-fetch.
    const unsub = subscribeAnalytics(
      ['user_sessions', 'user_events'],
      refetch,
      pulse,
    );
    return () => { cancelled = true; unsub(); };
  }, [pulse]);

  const sortedRows = useMemo(() => {
    const cmp = (a: UserAnalyticsRow, b: UserAnalyticsRow): number => {
      const dir = sortDir === 'asc' ? 1 : -1;
      switch (sortKey) {
        case 'name': {
          const an = (a.full_name || a.email || '').toLowerCase();
          const bn = (b.full_name || b.email || '').toLowerCase();
          return an.localeCompare(bn) * dir;
        }
        case 'last_sign_in_at': {
          const at = a.last_sign_in_at ? Date.parse(a.last_sign_in_at) : 0;
          const bt = b.last_sign_in_at ? Date.parse(b.last_sign_in_at) : 0;
          return (at - bt) * dir;
        }
        case 'sign_in_count':  return (a.sign_in_count     - b.sign_in_count)     * dir;
        case 'impressions':    return (a.total_impressions - b.total_impressions) * dir;
        case 'clicks':         return (a.total_clicks      - b.total_clicks)      * dir;
        case 'clickouts':      return (a.total_clickouts   - b.total_clickouts)   * dir;
        case 'ctr_click': {
          const ar = clickThroughRate(a) ?? -1;
          const br = clickThroughRate(b) ?? -1;
          return (ar - br) * dir;
        }
        case 'ctr_clickout': {
          const ar = clickoutRate(a) ?? -1;
          const br = clickoutRate(b) ?? -1;
          return (ar - br) * dir;
        }
        case 'total_session':  return (a.total_session_ms - b.total_session_ms) * dir;
        case 'avg_session':    return (a.avg_session_ms   - b.avg_session_ms)   * dir;
        case 'idle_session':   return (a.total_idle_ms    - b.total_idle_ms)    * dir;
      }
    };
    return [...rows].sort(cmp);
  }, [rows, sortKey, sortDir]);

  const onSort = (key: SortKey) => {
    setSortKey(prev => {
      if (prev === key) {
        setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        return prev;
      }
      // Numeric / date columns default to descending (most → least);
      // the name column defaults to ascending.
      setSortDir(key === 'name' ? 'asc' : 'desc');
      return key;
    });
  };

  if (!loaded) return <div className="admin-empty">Loading…</div>;
  if (rows.length === 0) return <div className="admin-empty">No users yet.</div>;

  return (
    <div className="admin-table-wrap">
      <div className="admin-table-toolbar">
        <LiveChip live={live} />
      </div>
      <table className="admin-table">
        <thead>
          <tr>
            <SortableTh col="name" label="User" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh col="last_sign_in_at" label="Last sign-in" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh col="sign_in_count" label="Sign-ins" sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
            <SortableTh col="impressions" label="Impressions" sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
            <SortableTh col="clicks" label="Clicks" sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
            <SortableTh col="clickouts" label="Clickouts" sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
            <SortableTh col="ctr_click" label="CTR (click)" sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
            <SortableTh col="ctr_clickout" label="CTR (clickout)" sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
            <SortableTh col="avg_session" label="Avg session" sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
            <SortableTh col="total_session" label="Total session" sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
            <SortableTh col="idle_session" label="Idle" sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
          </tr>
        </thead>
        <tbody>
          {sortedRows.map(row => {
            const ctrClick = clickThroughRate(row);
            const ctrClickout = clickoutRate(row);
            return (
              <tr key={row.user_id}>
                <td className="admin-cell-name">
                  {row.avatar_url
                    ? <img src={row.avatar_url} alt="" className="admin-user-avatar-img" />
                    : <span className="admin-user-avatar-img admin-user-avatar-placeholder">
                        {(row.full_name || row.email || '?').charAt(0).toUpperCase()}
                      </span>
                  }
                  <span>{row.full_name || row.email || row.user_id.slice(0, 8)}</span>
                </td>
                <td>{row.last_sign_in_at ? new Date(row.last_sign_in_at).toLocaleString() : '—'}</td>
                <td className="admin-cell-num">{row.sign_in_count.toLocaleString()}</td>
                <td className="admin-cell-num">{row.total_impressions.toLocaleString()}</td>
                <td className="admin-cell-num">{row.total_clicks.toLocaleString()}</td>
                <td className="admin-cell-num">{row.total_clickouts.toLocaleString()}</td>
                <td className="admin-cell-num">{ctrClick === null ? '—' : `${(ctrClick * 100).toFixed(1)}%`}</td>
                <td className="admin-cell-num">{ctrClickout === null ? '—' : `${(ctrClickout * 100).toFixed(1)}%`}</td>
                <td className="admin-cell-num">{formatDurationMs(row.avg_session_ms)}</td>
                <td className="admin-cell-num">{formatDurationMs(row.total_session_ms)}</td>
                <td className="admin-cell-num">{formatDurationMs(row.total_idle_ms)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SortableTh({
  col, label, sortKey, sortDir, onSort, numeric,
}: {
  col: SortKey;
  label: string;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (k: SortKey) => void;
  numeric?: boolean;
}) {
  const active = sortKey === col;
  return (
    <th
      className={`admin-th-sortable ${numeric ? 'admin-th-num' : ''} ${active ? 'is-active' : ''}`}
      onClick={() => onSort(col)}
      role="button"
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      {label}
      <span className="admin-th-arrow" aria-hidden="true">
        {active ? (sortDir === 'asc' ? '▲' : '▼') : ''}
      </span>
    </th>
  );
}

// ── Products tab ────────────────────────────────────────────────────────────

type ProductSortKey = 'product_name' | 'brand' | 'impressions' | 'clicks' | 'clickouts' | 'ctr_click' | 'ctr_clickout';

function ProductsAnalyticsStub() {
  return <ProductsAnalyticsTable />;
}

function ProductsAnalyticsTable() {
  const [rows, setRows] = useState<ProductAnalyticsRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sortKey, setSortKey] = useState<ProductSortKey>('clickouts');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const { live, pulse } = useLivePulse();

  useEffect(() => {
    let cancelled = false;
    const refetch = () => {
      getProductAnalytics().then(data => {
        if (cancelled) return;
        setRows(data);
        setLoaded(true);
      });
    };
    refetch();
    // Per-product table only cares about user_events writes.
    const unsub = subscribeAnalytics(['user_events'], refetch, pulse);
    return () => { cancelled = true; unsub(); };
  }, [pulse]);

  const sortedRows = useMemo(() => {
    const cmp = (a: ProductAnalyticsRow, b: ProductAnalyticsRow): number => {
      const dir = sortDir === 'asc' ? 1 : -1;
      switch (sortKey) {
        case 'product_name': return ((a.product_name || '').localeCompare(b.product_name || '')) * dir;
        case 'brand':        return ((a.brand        || '').localeCompare(b.brand        || '')) * dir;
        case 'impressions':  return (a.total_impressions - b.total_impressions) * dir;
        case 'clicks':       return (a.total_clicks      - b.total_clicks)      * dir;
        case 'clickouts':    return (a.total_clickouts   - b.total_clickouts)   * dir;
        case 'ctr_click': {
          const ar = clickThroughRate(a) ?? -1;
          const br = clickThroughRate(b) ?? -1;
          return (ar - br) * dir;
        }
        case 'ctr_clickout': {
          const ar = clickoutRate(a) ?? -1;
          const br = clickoutRate(b) ?? -1;
          return (ar - br) * dir;
        }
      }
    };
    return [...rows].sort(cmp);
  }, [rows, sortKey, sortDir]);

  const onSort = (key: ProductSortKey) => {
    setSortKey(prev => {
      if (prev === key) {
        setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        return prev;
      }
      setSortDir(key === 'product_name' || key === 'brand' ? 'asc' : 'desc');
      return key;
    });
  };

  if (!loaded) return <div className="admin-empty">Loading…</div>;
  if (rows.length === 0) return <div className="admin-empty">No product analytics yet.</div>;

  return (
    <div className="admin-table-wrap">
      <div className="admin-table-toolbar">
        <LiveChip live={live} />
      </div>
      <table className="admin-table admin-analytics-products">
        <thead>
          <tr>
            <th className="admin-th-thumb" aria-label="Thumbnail" />
            <ProductTh col="product_name" label="Product" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <ProductTh col="brand" label="Brand" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <ProductTh col="impressions" label="Impressions" sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
            <ProductTh col="clicks" label="Clicks" sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
            <ProductTh col="clickouts" label="Clickouts" sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
            <ProductTh col="ctr_click" label="CTR (click)" sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
            <ProductTh col="ctr_clickout" label="CTR (clickout)" sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
          </tr>
        </thead>
        <tbody>
          {sortedRows.map(row => {
            const ctrClick = clickThroughRate(row);
            const ctrClickout = clickoutRate(row);
            return (
              <tr key={row.product_id}>
                <td className="admin-cell-thumb">
                  {row.image_url
                    ? <img src={row.image_url} alt="" className="admin-product-thumb" loading="lazy" decoding="async" />
                    : <span className="admin-product-thumb admin-product-thumb--empty" aria-hidden="true" />}
                </td>
                <td className="admin-cell-name admin-cell-name--clip" title={row.product_name ?? undefined}>
                  {row.product_name || '—'}
                </td>
                <td className="admin-cell-muted">{row.brand || '—'}</td>
                <td className="admin-cell-num">{row.total_impressions.toLocaleString()}</td>
                <td className="admin-cell-num">{row.total_clicks.toLocaleString()}</td>
                <td className="admin-cell-num">{row.total_clickouts.toLocaleString()}</td>
                <td className="admin-cell-num">{ctrClick === null ? '—' : `${(ctrClick * 100).toFixed(1)}%`}</td>
                <td className="admin-cell-num">{ctrClickout === null ? '—' : `${(ctrClickout * 100).toFixed(1)}%`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ProductTh({
  col, label, sortKey, sortDir, onSort, numeric,
}: {
  col: ProductSortKey;
  label: string;
  sortKey: ProductSortKey;
  sortDir: 'asc' | 'desc';
  onSort: (k: ProductSortKey) => void;
  numeric?: boolean;
}) {
  const active = sortKey === col;
  return (
    <th
      className={`admin-th-sortable ${numeric ? 'admin-th-num' : ''} ${active ? 'is-active' : ''}`}
      onClick={() => onSort(col)}
      role="button"
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      {label}
      <span className="admin-th-arrow" aria-hidden="true">
        {active ? (sortDir === 'asc' ? '▲' : '▼') : ''}
      </span>
    </th>
  );
}
