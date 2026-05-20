import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from '@remix-run/react';
import {
  getUserAnalytics,
  getProductAnalytics,
  getBrandAnalytics,
  getCreatorContentAnalytics,
  clickThroughRate,
  clickoutRate,
  formatDurationMs,
  type UserAnalyticsRow,
  type ProductAnalyticsRow,
  type BrandAnalyticsRow,
  type CreatorContentAnalyticsRow,
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

type Tab = 'users' | 'products' | 'brands';
const TAB_VALUES: readonly Tab[] = ['users', 'products', 'brands'];
function isTab(v: string | null): v is Tab {
  return v !== null && (TAB_VALUES as readonly string[]).includes(v);
}

type UsersView = 'shopper' | 'creator';
const USERS_VIEW_VALUES: readonly UsersView[] = ['shopper', 'creator'];
function isUsersView(v: string | null): v is UsersView {
  return v !== null && (USERS_VIEW_VALUES as readonly string[]).includes(v);
}

export default function AdminAnalytics() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = isTab(searchParams.get('tab')) ? (searchParams.get('tab') as Tab) : 'users';
  const usersView: UsersView = isUsersView(searchParams.get('view'))
    ? (searchParams.get('view') as UsersView)
    : 'shopper';
  const setTab = useCallback((next: Tab) => {
    setSearchParams(prev => {
      const out = new URLSearchParams(prev);
      if (next === 'users') out.delete('tab');
      else                  out.set('tab', next);
      // The `view` sub-toggle only applies to the Users tab.
      if (next !== 'users') out.delete('view');
      return out;
    }, { replace: false });
  }, [setSearchParams]);
  const setUsersView = useCallback((next: UsersView) => {
    setSearchParams(prev => {
      const out = new URLSearchParams(prev);
      if (next === 'shopper') out.delete('view');
      else                    out.set('view', next);
      return out;
    }, { replace: false });
  }, [setSearchParams]);

  const [tableMeta, setTableMeta] = useState<{ count: number | null; live: boolean }>({ count: null, live: false });
  const handleMeta = useCallback((count: number, live: boolean) => {
    setTableMeta({ count, live });
  }, []);

  // Reset when switching tabs / sub-views so stale count doesn't flash
  useEffect(() => {
    setTableMeta({ count: null, live: false });
  }, [tab, usersView]);

  const countLabel = tableMeta.count === null ? null : (() => {
    const n = tableMeta.count.toLocaleString();
    if (tab === 'users')    return `${n} ${tableMeta.count === 1 ? 'user'    : 'users'}`;
    if (tab === 'products') return `${n} ${tableMeta.count === 1 ? 'product' : 'products'}`;
    return `${n} ${tableMeta.count === 1 ? 'brand' : 'brands'}`;
  })();

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Analytics</h1>
        <p className="admin-page-subtitle">Per-user engagement and per-product performance</p>
      </div>
      <div className="admin-analytics-tabbar">
        <div className="admin-tabs">
          <button className={`admin-tab ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>
            Users
          </button>
          <button className={`admin-tab ${tab === 'products' ? 'active' : ''}`} onClick={() => setTab('products')}>
            Products
          </button>
          <button className={`admin-tab ${tab === 'brands' ? 'active' : ''}`} onClick={() => setTab('brands')}>
            Brands
          </button>
        </div>
        {tab === 'users' && (
          <div className="admin-tabs">
            <button
              className={`admin-tab admin-tab-sub ${usersView === 'shopper' ? 'active' : ''}`}
              onClick={() => setUsersView('shopper')}
            >
              Shopper
            </button>
            <button
              className={`admin-tab admin-tab-sub ${usersView === 'creator' ? 'active' : ''}`}
              onClick={() => setUsersView('creator')}
            >
              Creator
            </button>
          </div>
        )}
        <div className="admin-tabs-meta">
          {countLabel !== null && (
            <span className="admin-table-count">{countLabel}</span>
          )}
          <LiveChip live={tableMeta.live} />
        </div>
      </div>

      {tab === 'users' && usersView === 'shopper' && <UsersAnalyticsTable onMeta={handleMeta} />}
      {tab === 'users' && usersView === 'creator' && <CreatorContentAnalyticsTable onMeta={handleMeta} />}
      {tab === 'products' && <ProductsAnalyticsTable onMeta={handleMeta} />}
      {tab === 'brands' && <BrandsAnalyticsTable onMeta={handleMeta} />}
    </div>
  );
}

// ── Users tab ────────────────────────────────────────────────────────────────

type SortKey =
  | 'name' | 'last_sign_in_at' | 'sign_in_count'
  | 'impressions' | 'clicks' | 'clickouts'
  | 'ctr_click' | 'ctr_clickout'
  | 'total_session' | 'avg_session' | 'idle_session';

function UsersAnalyticsTable({ onMeta }: { onMeta: (count: number, live: boolean) => void }) {
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

  useEffect(() => { onMeta(sortedRows.length, live); }, [sortedRows.length, live, onMeta]);

  if (!loaded) return <div className="admin-empty">Loading…</div>;
  if (rows.length === 0) return <div className="admin-empty">No users yet.</div>;

  return (
    <div className="admin-table-wrap">
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
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {label}
        <svg
          aria-hidden="true"
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          style={{ opacity: active ? 0.7 : 0.25, flexShrink: 0, transition: 'opacity 0.15s, transform 0.15s',
            transform: active && sortDir === 'asc' ? 'rotate(180deg)' : 'none' }}
        >
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </th>
  );
}

// ── Products tab ────────────────────────────────────────────────────────────

type ProductSortKey = 'product_name' | 'brand' | 'impressions' | 'clicks' | 'clickouts' | 'ctr_click' | 'ctr_clickout';


function ProductsAnalyticsTable({ onMeta }: { onMeta: (count: number, live: boolean) => void }) {
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

  useEffect(() => { onMeta(sortedRows.length, live); }, [sortedRows.length, live, onMeta]);

  if (!loaded) return <div className="admin-empty">Loading…</div>;
  if (rows.length === 0) return <div className="admin-empty">No product analytics yet.</div>;

  return (
    <div className="admin-table-wrap">
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
                <td className="admin-cell-product-name" title={row.product_name ?? undefined}>
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
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {label}
        <svg
          aria-hidden="true"
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          style={{ opacity: active ? 0.7 : 0.25, flexShrink: 0, transition: 'opacity 0.15s, transform 0.15s',
            transform: active && sortDir === 'asc' ? 'rotate(180deg)' : 'none' }}
        >
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </th>
  );
}

// ── Brands tab ──────────────────────────────────────────────────────────────

type BrandSortKey = 'brand' | 'product_count' | 'impressions' | 'clicks' | 'clickouts' | 'ctr_click' | 'ctr_clickout';

function BrandsAnalyticsTable({ onMeta }: { onMeta: (count: number, live: boolean) => void }) {
  const [rows, setRows] = useState<BrandAnalyticsRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sortKey, setSortKey] = useState<BrandSortKey>('clickouts');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const { live, pulse } = useLivePulse();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const refetch = () => {
      getBrandAnalytics().then(data => {
        if (cancelled) return;
        setRows(data);
        setLoaded(true);
      });
    };
    refetch();
    const unsub = subscribeAnalytics(['user_events'], refetch, pulse);
    return () => { cancelled = true; unsub(); };
  }, [pulse]);

  const sortedRows = useMemo(() => {
    const cmp = (a: BrandAnalyticsRow, b: BrandAnalyticsRow): number => {
      const dir = sortDir === 'asc' ? 1 : -1;
      switch (sortKey) {
        case 'brand':         return (a.brand || '').localeCompare(b.brand || '') * dir;
        case 'product_count': return (a.product_count    - b.product_count)    * dir;
        case 'impressions':   return (a.total_impressions - b.total_impressions) * dir;
        case 'clicks':        return (a.total_clicks      - b.total_clicks)      * dir;
        case 'clickouts':     return (a.total_clickouts   - b.total_clickouts)   * dir;
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

  const onSort = (key: BrandSortKey) => {
    setSortKey(prev => {
      if (prev === key) {
        setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        return prev;
      }
      setSortDir(key === 'brand' ? 'asc' : 'desc');
      return key;
    });
  };

  useEffect(() => { onMeta(sortedRows.length, live); }, [sortedRows.length, live, onMeta]);

  if (!loaded) return <div className="admin-empty">Loading…</div>;
  if (rows.length === 0) return <div className="admin-empty">No brand data yet.</div>;

  return (
    <div className="admin-table-wrap">
      <table className="admin-table admin-analytics-brands">
        <thead>
          <tr>
            <BrandTh col="brand"         label="Brand"       sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <BrandTh col="product_count" label="Products"    sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
            <BrandTh col="impressions"   label="Impressions" sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
            <BrandTh col="clicks"        label="Clicks"      sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
            <BrandTh col="clickouts"     label="Clickouts"   sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
            <BrandTh col="ctr_click"     label="CTR (click)"    sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
            <BrandTh col="ctr_clickout"  label="CTR (clickout)" sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
            <th className="admin-th-actions" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {sortedRows.map(row => {
            const ctrClick    = clickThroughRate(row);
            const ctrClickout = clickoutRate(row);
            return (
              <tr key={row.brand}>
                <td className="admin-cell-name">{row.brand}</td>
                <td className="admin-cell-num">{row.product_count.toLocaleString()}</td>
                <td className="admin-cell-num">{row.total_impressions.toLocaleString()}</td>
                <td className="admin-cell-num">{row.total_clicks.toLocaleString()}</td>
                <td className="admin-cell-num">{row.total_clickouts.toLocaleString()}</td>
                <td className="admin-cell-num">{ctrClick    === null ? '—' : `${(ctrClick    * 100).toFixed(1)}%`}</td>
                <td className="admin-cell-num">{ctrClickout === null ? '—' : `${(ctrClickout * 100).toFixed(1)}%`}</td>
                <td className="admin-cell-actions">
                  <button
                    className="admin-icon-btn"
                    title={`View products for ${row.brand}`}
                    aria-label={`View products for ${row.brand}`}
                    onClick={() => navigate(`/admin/content?tab=products&brand=${encodeURIComponent(row.brand)}`)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BrandTh({
  col, label, sortKey, sortDir, onSort, numeric,
}: {
  col: BrandSortKey;
  label: string;
  sortKey: BrandSortKey;
  sortDir: 'asc' | 'desc';
  onSort: (k: BrandSortKey) => void;
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
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {label}
        <svg
          aria-hidden="true"
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          style={{ opacity: active ? 0.7 : 0.25, flexShrink: 0, transition: 'opacity 0.15s, transform 0.15s',
            transform: active && sortDir === 'asc' ? 'rotate(180deg)' : 'none' }}
        >
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </th>
  );
}

// ── Users tab → Creator sub-view ────────────────────────────────────────────

type CreatorSortKey =
  | 'name' | 'last_sign_in_at' | 'looks_posted'
  | 'impressions' | 'clicks' | 'clickouts'
  | 'ctr_click' | 'ctr_clickout';

function CreatorContentAnalyticsTable({ onMeta }: { onMeta: (count: number, live: boolean) => void }) {
  const [rows, setRows] = useState<CreatorContentAnalyticsRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sortKey, setSortKey] = useState<CreatorSortKey>('looks_posted');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const { live, pulse } = useLivePulse();

  useEffect(() => {
    let cancelled = false;
    const refetch = () => {
      getCreatorContentAnalytics().then(data => {
        if (cancelled) return;
        setRows(data);
        setLoaded(true);
      });
    };
    refetch();
    // user_events drives the engagement counters; user_generations
    // drives the looks_posted count when a creator publishes.
    const unsub = subscribeAnalytics(
      ['user_events', 'user_generations'],
      refetch,
      pulse,
    );
    return () => { cancelled = true; unsub(); };
  }, [pulse]);

  const sortedRows = useMemo(() => {
    const cmp = (a: CreatorContentAnalyticsRow, b: CreatorContentAnalyticsRow): number => {
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
        case 'looks_posted':   return (a.looks_posted      - b.looks_posted)      * dir;
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
      }
    };
    return [...rows].sort(cmp);
  }, [rows, sortKey, sortDir]);

  const onSort = (key: CreatorSortKey) => {
    setSortKey(prev => {
      if (prev === key) {
        setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        return prev;
      }
      setSortDir(key === 'name' ? 'asc' : 'desc');
      return key;
    });
  };

  useEffect(() => { onMeta(sortedRows.length, live); }, [sortedRows.length, live, onMeta]);

  if (!loaded) return <div className="admin-empty">Loading…</div>;
  if (rows.length === 0) return <div className="admin-empty">No users yet.</div>;

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <CreatorTh col="name" label="User" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <CreatorTh col="last_sign_in_at" label="Last sign-in" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <CreatorTh col="looks_posted" label="Looks posted" sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
            <CreatorTh col="impressions" label="Impressions" sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
            <CreatorTh col="clicks" label="Clicks" sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
            <CreatorTh col="clickouts" label="Clickouts" sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
            <CreatorTh col="ctr_click" label="CTR (click)" sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
            <CreatorTh col="ctr_clickout" label="CTR (clickout)" sortKey={sortKey} sortDir={sortDir} onSort={onSort} numeric />
          </tr>
        </thead>
        <tbody>
          {sortedRows.map(row => {
            // Users with 0 published looks render '—' in every metric
            // column so the table doesn't suggest "0 clicks" was earned.
            const hasLooks = row.looks_posted > 0;
            const ctrClick = hasLooks ? clickThroughRate(row) : null;
            const ctrClickout = hasLooks ? clickoutRate(row) : null;
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
                <td className="admin-cell-num">{row.looks_posted.toLocaleString()}</td>
                <td className="admin-cell-num">{hasLooks ? row.total_impressions.toLocaleString() : '—'}</td>
                <td className="admin-cell-num">{hasLooks ? row.total_clicks.toLocaleString()      : '—'}</td>
                <td className="admin-cell-num">{hasLooks ? row.total_clickouts.toLocaleString()   : '—'}</td>
                <td className="admin-cell-num">{ctrClick    === null ? '—' : `${(ctrClick    * 100).toFixed(1)}%`}</td>
                <td className="admin-cell-num">{ctrClickout === null ? '—' : `${(ctrClickout * 100).toFixed(1)}%`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CreatorTh({
  col, label, sortKey, sortDir, onSort, numeric,
}: {
  col: CreatorSortKey;
  label: string;
  sortKey: CreatorSortKey;
  sortDir: 'asc' | 'desc';
  onSort: (k: CreatorSortKey) => void;
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
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {label}
        <svg
          aria-hidden="true"
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          style={{ opacity: active ? 0.7 : 0.25, flexShrink: 0, transition: 'opacity 0.15s, transform 0.15s',
            transform: active && sortDir === 'asc' ? 'rotate(180deg)' : 'none' }}
        >
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </th>
  );
}
