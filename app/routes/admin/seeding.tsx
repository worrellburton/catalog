// Admin · Seeding — control panel for demand-driven catalog seeding.
// Two tabs split seed_targets by kind: "Searches" (keyword/manual demand) and
// "Styling" (scenarios). Same data + actions per tab. Operator curates
// (approve/pause/reject), flips the global kill-switch, sets the budget,
// refreshes demand, and runs a target on demand. The loop only spends/publishes
// while the kill-switch is ON. See docs/CATALOG_SEEDING.md.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { useSortableTable, SortableTh } from '~/components/SortableTable';

interface SeedTarget {
  id: string;
  term: string;
  kind: string;
  status: string;
  priority: number;
  search_hits: number;
  zero_result: boolean;
  last_run_at: string | null;
  run_count: number;
  products_found: number;
  products_published: number;
}

type TopTab = 'searches' | 'styling';
const STATUSES = ['pending', 'approved', 'paused', 'rejected', 'done'] as const;
const PAGE_SIZE = 25;

interface CronRow {
  jobname: string;
  schedule: string;
  active: boolean;
  last_status: string | null;
  last_run: string | null;
}

const CRON_LABELS: Record<string, string> = {
  'seeding-curate': 'Auto-curate pending (Claude)',
  'seeding-refresh': 'Pull search demand',
  'seeding-driver': 'Fetch products (spends $)',
  'seeding-occasion': 'Enrich occasions',
  'seeding-activate': 'Publish (quality gate)',
  'seeding-budget-reset': 'Reset monthly budget',
};

function humanCron(s: string): string {
  const m: Record<string, string> = {
    '*/10 * * * *': 'every 10 min', '*/15 * * * *': 'every 15 min', '*/30 * * * *': 'every 30 min',
    '0 * * * *': 'hourly', '0 0 1 * *': 'monthly (1st)',
  };
  return m[s] || s;
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3.6e6);
  if (h < 1) return `${Math.max(1, Math.floor(diff / 6e4))}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function statusDotKind(status: string): 'live' | 'failed' | 'inactive' {
  if (status === 'approved' || status === 'done') return 'live';
  if (status === 'rejected') return 'failed';
  return 'inactive';
}

export default function SeedingPage() {
  const [targets, setTargets] = useState<SeedTarget[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [cap, setCap] = useState(0);
  const [used, setUsed] = useState(0);
  const [seededCount, setSeededCount] = useState(0);
  const [crons, setCrons] = useState<CronRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [topTab, setTopTab] = useState<TopTab>('searches');
  const [filter, setFilter] = useState<string>('all');
  const [newTerm, setNewTerm] = useState('');
  const [page, setPage] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [{ data: rows }, { data: settings }, { count: seeded }, { data: cronRows }] = await Promise.all([
      supabase.from('seed_targets').select('*').order('priority', { ascending: false }).limit(1000),
      supabase.from('app_settings').select('key, value')
        .in('key', ['seeding_enabled', 'seeding_monthly_serpapi_cap', 'seeding_serpapi_used_month']),
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('source', 'seed_serpapi'),
      supabase.rpc('seeding_cron_status'),
    ]);
    setTargets((rows ?? []) as SeedTarget[]);
    const map = new Map((settings ?? []).map(s => [s.key, s.value] as [string, string]));
    setEnabled(map.get('seeding_enabled') === 'true');
    setCap(Number(map.get('seeding_monthly_serpapi_cap') || '0'));
    setUsed(Number(map.get('seeding_serpapi_used_month') || '0'));
    setSeededCount(seeded ?? 0);
    setCrons((cronRows ?? []) as CronRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const setSetting = useCallback(async (key: string, value: string) => {
    if (!supabase) return;
    const { error } = await supabase.rpc('admin_set_seeding_setting', { p_key: key, p_value: value });
    if (error) setMsg(`Error: ${error.message}`);
    await load();
  }, [load]);

  // Master switch: start/stop the kill-switch AND every seeding cron together.
  const setMaster = useCallback(async (on: boolean) => {
    if (!supabase) return;
    if (!on && !window.confirm('Pause everything? This stops the loop and pauses all seeding crons.')) return;
    setBusy('master');
    const { error } = await supabase.rpc('set_seeding_master', { p_on: on });
    if (error) setMsg(`Error: ${error.message}`);
    setBusy(null);
    await load();
  }, [load]);

  const setStatus = useCallback(async (id: string, status: string) => {
    if (!supabase) return;
    await supabase.from('seed_targets').update({ status }).eq('id', id);
    await load();
  }, [load]);

  const refreshFromSearches = useCallback(async () => {
    if (!supabase) return;
    setBusy('refresh');
    const { data, error } = await supabase.rpc('refresh_seed_targets_from_searches');
    setMsg(error ? `Error: ${error.message}` : `Refreshed — ${data} targets from search demand.`);
    setBusy(null);
    await load();
  }, [load]);

  const toggleCron = useCallback(async (jobname: string, active: boolean) => {
    if (!supabase) return;
    const { error } = await supabase.rpc('set_seeding_cron_active', { p_jobname: jobname, p_active: active });
    if (error) setMsg(`Error: ${error.message}`);
    await load();
  }, [load]);

  const autoCurate = useCallback(async () => {
    if (!supabase) return;
    setBusy('curate');
    const { data, error } = await supabase.functions.invoke('seed-curate', { body: { limit: 50 } });
    setMsg(error ? `Error: ${error.message}`
      : `Auto-curated — ${data?.approved ?? 0} approved, ${data?.rejected ?? 0} rejected (${data?.processed ?? 0} pending checked).`);
    setBusy(null);
    await load();
  }, [load]);

  const runNow = useCallback(async (id: string) => {
    if (!supabase) return;
    setBusy(id);
    const { data, error } = await supabase.functions.invoke('seed-run', { body: { targetId: id } });
    if (error) setMsg(`Error: ${error.message}`);
    else if (data?.skipped) setMsg(`Skipped: ${data.skipped} — enable seeding first.`);
    else setMsg(`Ran — ${JSON.stringify(data?.results ?? [])}`);
    setBusy(null);
    await load();
  }, [load]);

  const purgeSeeded = useCallback(async () => {
    if (!supabase) return;
    if (!window.confirm(`Delete all ${seededCount} seeded products (source=seed_serpapi)? This cannot be undone.`)) return;
    setBusy('purge');
    const { data, error } = await supabase.rpc('purge_seeded_products');
    setMsg(error ? `Error: ${error.message}` : `Purged ${data} seeded products.`);
    setBusy(null);
    await load();
  }, [seededCount, load]);

  const addTarget = useCallback(async () => {
    const term = newTerm.trim();
    if (!supabase || !term) return;
    // Kind follows the active tab (not word-count) so "Add scenario" always
    // lands a scenario and "Add search" a keyword.
    const kind = topTab === 'styling' ? 'scenario' : 'manual';
    const { error } = await supabase.from('seed_targets')
      .insert({ term: term.toLowerCase(), kind, status: 'approved', priority: 50 });
    setMsg(error ? `Error: ${error.message}` : `Added "${term}" to ${topTab === 'styling' ? 'Styling' : 'Searches'}.`);
    setNewTerm('');
    await load();
  }, [newTerm, topTab, load]);

  // Split by kind. Searches = keyword/manual demand; Styling = scenarios.
  const searchTargets = useMemo(() => targets.filter(t => t.kind === 'keyword' || t.kind === 'manual'), [targets]);
  const stylingTargets = useMemo(() => targets.filter(t => t.kind === 'scenario'), [targets]);
  const tabTargets = topTab === 'styling' ? stylingTargets : searchTargets;

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: tabTargets.length };
    for (const s of STATUSES) c[s] = tabTargets.filter(t => t.status === s).length;
    return c;
  }, [tabTargets]);
  const shown = useMemo(
    () => (filter === 'all' ? tabTargets : tabTargets.filter(t => t.status === filter)),
    [tabTargets, filter],
  );

  // Default order: rejected pinned to the bottom, then priority desc. Fed to the
  // sortable hook WITHOUT a default sort, so clicking a column header still sorts.
  const ordered = useMemo(() => {
    const rank = (s: string) => (s === 'rejected' ? 1 : 0);
    return [...shown].sort((a, b) => rank(a.status) - rank(b.status) || b.priority - a.priority);
  }, [shown]);

  const table = useSortableTable(ordered);

  const pageCount = Math.max(1, Math.ceil(table.sortedData.length / PAGE_SIZE));
  const pageSafe = Math.min(page, pageCount - 1);
  const paged = table.sortedData.slice(pageSafe * PAGE_SIZE, (pageSafe + 1) * PAGE_SIZE);
  useEffect(() => { setPage(0); }, [topTab, filter, table.sort]);

  if (loading) return <div className="admin-page"><p>Loading seeding…</p></div>;

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1>Seeding</h1>
          <p className="admin-page-subtitle">
            Demand-driven catalog seeding. Approve keywords/scenarios; the loop fetches, quality-gates,
            and publishes — only while the switch below is ON.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/admin/data?tab=products&filters=seeding" className="admin-btn admin-btn-secondary">
            View seeded products ({seededCount})
          </Link>
          <Link to="/admin/seeding/simulate" className="admin-btn admin-btn-secondary">▶ Simulate</Link>
        </div>
      </div>

      {/* Shared controls. color-scheme:light keeps native controls (checkbox,
          number spinner, text inputs) light under an OS dark-mode preference. */}
      <div className="admin-detail-card" style={{ marginBottom: 16, colorScheme: 'light' }}>
        {/* Master switch — flips the kill-switch AND every cron together. */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid #ececec' }}>
          <button
            className="admin-btn admin-btn-primary"
            disabled={busy === 'master'}
            onClick={() => void setMaster(!enabled)}
            style={enabled ? { background: '#dc2626', borderColor: '#dc2626', color: '#fff' } : undefined}
          >
            {busy === 'master' ? '…' : enabled ? '⏸ Pause everything' : '▶ Enable everything'}
          </button>
          <span className="admin-cell-muted" style={{ fontSize: 13 }}>
            {enabled ? 'Loop + crons running — fetching, enriching, publishing.' : 'Loop + crons paused — nothing runs.'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={enabled}
              onChange={e => void setSetting('seeding_enabled', e.target.checked ? 'true' : 'false')} />
            <span className={`admin-status-dot admin-status-dot--${enabled ? 'live' : 'failed'}`} />
            <strong>{enabled ? 'Seeding ON' : 'Seeding OFF'}</strong>
          </label>
          <div>
            Budget: <strong>{used}</strong> / {cap} SerpAPI searches this month
            {cap > 0 && used >= cap && <span className="admin-status-warning" style={{ marginLeft: 6 }}>cap reached</span>}
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            Cap:
            <input type="number" className="admin-date-input" defaultValue={cap} style={{ width: 90 }}
              onBlur={e => { const v = e.target.value; if (Number(v) !== cap) void setSetting('seeding_monthly_serpapi_cap', String(Math.max(0, Number(v) || 0))); }} />
          </label>
          <button className="admin-btn admin-btn-secondary" onClick={() => void setSetting('seeding_serpapi_used_month', '0')}>Reset budget</button>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {topTab === 'searches' && (
            <button className="admin-btn admin-btn-secondary" disabled={busy === 'refresh'} onClick={() => void refreshFromSearches()}>
              {busy === 'refresh' ? 'Refreshing…' : 'Refresh from searches'}
            </button>
          )}
          <button className="admin-btn admin-btn-secondary" disabled={busy === 'curate'} onClick={() => void autoCurate()}
            title="Claude approves real terms and rejects gibberish among pending">
            {busy === 'curate' ? 'Curating…' : 'Auto-curate pending'}
          </button>
          <input
            className="admin-date-input"
            placeholder={topTab === 'styling' ? 'Add a scenario…' : 'Add a search keyword…'}
            value={newTerm} onChange={e => setNewTerm(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void addTarget(); }}
            style={{ flex: '1 1 240px', minWidth: 200 }} />
          <button className="admin-btn admin-btn-primary" onClick={() => void addTarget()} disabled={!newTerm.trim()}>
            {topTab === 'styling' ? '+ Add scenario' : '+ Add search'}
          </button>
          <button className="admin-btn admin-btn-secondary" disabled={busy === 'purge' || seededCount === 0}
            onClick={() => void purgeSeeded()} title="Delete every product seeded by this loop (source=seed_serpapi)">
            {busy === 'purge' ? 'Purging…' : `Purge seeded (${seededCount})`}
          </button>
        </div>
      </div>

      {/* Automation — the seeding crons. They run on schedule always; the
          gated ones (fetch/enrich/publish) only act while Seeding is ON.
          Pause/resume any here. */}
      {crons.length > 0 && (
        <div className="admin-detail-card" style={{ marginBottom: 16, colorScheme: 'light' }}>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>Automation</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) auto auto auto', gap: '8px 16px', alignItems: 'center', fontSize: 13 }}>
            {crons.map(c => (
              <Fragment key={c.jobname}>
                <div>{CRON_LABELS[c.jobname] || c.jobname}</div>
                <div className="admin-cell-muted">{humanCron(c.schedule)}</div>
                <div className="admin-cell-muted" title={c.last_run || ''}>
                  {c.last_status ? `${c.last_status} · ${timeAgo(c.last_run)}` : 'not yet run'}
                </div>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', justifySelf: 'end' }}>
                  <input type="checkbox" checked={c.active} onChange={e => void toggleCron(c.jobname, e.target.checked)} />
                  <span style={{ color: c.active ? '#0d9488' : '#888' }}>{c.active ? 'on' : 'paused'}</span>
                </label>
              </Fragment>
            ))}
          </div>
        </div>
      )}

      {msg && <div className="admin-status-warning" style={{ margin: '8px 0', fontSize: 13 }}>{msg}</div>}

      {/* Top tabs: Searches | Styling */}
      <div className="admin-tabs">
        <button className={`admin-tab ${topTab === 'searches' ? 'active' : ''}`} onClick={() => setTopTab('searches')}>
          Searches<span className="admin-tab-badge">{searchTargets.length}</span>
        </button>
        <button className={`admin-tab ${topTab === 'styling' ? 'active' : ''}`} onClick={() => setTopTab('styling')}>
          Styling<span className="admin-tab-badge">{stylingTargets.length}</span>
        </button>
      </div>

      {/* Status sub-filter (scoped to active tab) */}
      <div className="admin-tabs" style={{ marginBottom: 12 }}>
        {(['all', ...STATUSES] as string[]).map(s => (
          <button key={s} className={`admin-tab ${filter === s ? 'active' : ''}`} onClick={() => setFilter(s)}>
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            <span className="admin-tab-badge">{counts[s] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Targets table */}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <SortableTh label="Target" sortKey="term" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Demand" sortKey="search_hits" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Status" sortKey="status" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Priority" sortKey="priority" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Last run" sortKey="last_run_at" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Found" sortKey="products_found" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Published" sortKey="products_published" currentSort={table.sort} onSort={table.handleSort} />
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paged.map(t => (
              <tr key={t.id}>
                <td className="admin-cell-name">
                  <Link to={`/admin/data?tab=products&filters=seeding&target=${t.id}&label=${encodeURIComponent(t.term)}`}
                    title="View this target's products">{t.term}</Link>
                </td>
                <td className="admin-cell-num">{t.search_hits}{t.zero_result && <span title="returned nothing" style={{ color: '#ea4335' }}> ⚑</span>}</td>
                <td><span className={`admin-status-dot admin-status-dot--${statusDotKind(t.status)}`} /> {t.status}</td>
                <td className="admin-cell-num">{t.priority}</td>
                <td className="admin-cell-muted">{timeAgo(t.last_run_at)}</td>
                <td className="admin-cell-num">
                  {t.products_found > 0
                    ? <Link to={`/admin/data?tab=products&filters=seeding&target=${t.id}&label=${encodeURIComponent(t.term)}`} title="View the products this target fetched">{t.products_found}</Link>
                    : 0}
                </td>
                <td className="admin-cell-num">{t.products_published}</td>
                <td style={{ whiteSpace: 'nowrap', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  {t.status !== 'approved' && <button className="admin-btn admin-btn-secondary admin-row-promote" onClick={() => void setStatus(t.id, 'approved')}>Approve</button>}
                  {t.status !== 'paused' && <button className="admin-btn admin-btn-secondary admin-row-promote" onClick={() => void setStatus(t.id, 'paused')}>Pause</button>}
                  {t.status !== 'rejected' && <button className="admin-btn admin-btn-secondary admin-row-promote" onClick={() => void setStatus(t.id, 'rejected')}>Reject</button>}
                  {t.status === 'approved' && <button className="admin-btn admin-btn-primary admin-row-promote" disabled={busy === t.id} onClick={() => void runNow(t.id)}>{busy === t.id ? '…' : 'Run'}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {table.sortedData.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: '#888', fontSize: 13 }}>No targets.</div>
        )}
      </div>

      {table.sortedData.length > PAGE_SIZE && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginTop: 12, fontSize: 13 }}>
          <span className="admin-cell-muted">{table.sortedData.length} targets · page {pageSafe + 1} of {pageCount}</span>
          <button className="admin-btn admin-btn-secondary" disabled={pageSafe === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Prev</button>
          <button className="admin-btn admin-btn-secondary" disabled={pageSafe >= pageCount - 1} onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}>Next</button>
        </div>
      )}
    </div>
  );
}
