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
import StyleSimulateModal, { type SimStylist, type SimUser } from '~/components/StyleSimulateModal';
import StyleInfoModal from '~/components/StyleInfoModal';
import ScenarioProductsModal from '~/components/ScenarioProductsModal';

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
  intent: Record<string, unknown> | null;
  last_result: Record<string, unknown> | null;
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
  'seeding-style-generate': 'Generate styling scenarios (Claude)',
  'seeding-style-demand': 'Pull stylist-chat demand',
  'seeding-gap-sweep': 'Auto-seed scenario gaps',
};

function humanCron(s: string): string {
  const m: Record<string, string> = {
    '*/10 * * * *': 'every 10 min', '*/15 * * * *': 'every 15 min', '*/30 * * * *': 'every 30 min',
    '0 * * * *': 'hourly', '0 0 1 * *': 'monthly (1st)', '30 5 * * 1': 'weekly (Mon)',
    '0 4 * * *': 'daily (4am)',
  };
  return m[s] || s;
}

// Which automation belongs to which tab — Styling crons (scenario generation,
// stylist-chat demand, gap-sweep) vs the Searches demand/fetch pipeline.
function isStylingCron(jobname: string): boolean {
  return jobname.startsWith('seeding-style') || jobname === 'seeding-gap-sweep';
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
  const [listQuery, setListQuery] = useState('');
  const [newTerm, setNewTerm] = useState('');
  const [page, setPage] = useState(0);
  const [showInfo, setShowInfo] = useState(false);
  const [showStyleInfo, setShowStyleInfo] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Styling-tab simulation cockpit.
  const [stylists, setStylists] = useState<SimStylist[]>([]);
  const [users, setUsers] = useState<SimUser[]>([]);
  const [simScenario, setSimScenario] = useState<SeedTarget | null>(null);
  const [productsScenario, setProductsScenario] = useState<SeedTarget | null>(null);
  const [simSpend, setSimSpend] = useState<{ total: number; runs: number } | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [{ data: rows }, { data: settings }, { count: seeded }, { data: cronRows }, { data: spendRows }] = await Promise.all([
      supabase.from('seed_targets').select('*').order('priority', { ascending: false }).limit(1000),
      supabase.from('app_settings').select('key, value')
        .in('key', ['seeding_enabled', 'seeding_monthly_serpapi_cap', 'seeding_serpapi_used_month']),
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('source', 'seed_serpapi'),
      supabase.rpc('seeding_cron_status'),
      supabase.rpc('style_engine_spend'),
    ]);
    setTargets((rows ?? []) as SeedTarget[]);
    const spendRow = (spendRows as Array<{ total_cost: number; runs: number }> | null)?.[0];
    setSimSpend(spendRow ? { total: Number(spendRow.total_cost), runs: Number(spendRow.runs) } : { total: 0, runs: 0 });
    const map = new Map((settings ?? []).map(s => [s.key, s.value] as [string, string]));
    setEnabled(map.get('seeding_enabled') === 'true');
    setCap(Number(map.get('seeding_monthly_serpapi_cap') || '0'));
    setUsed(Number(map.get('seeding_serpapi_used_month') || '0'));
    setSeededCount(seeded ?? 0);
    setCrons((cronRows ?? []) as CronRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Pickers for the Styling-tab simulation cockpit — loaded once.
  useEffect(() => {
    if (!supabase) return;
    void (async () => {
      const [{ data: st }, { data: us }] = await Promise.all([
        supabase.from('style_up_stylists').select('id, name, specialty, source_mode').eq('is_active', true).order('sort', { ascending: true }),
        supabase.from('profiles').select('id, full_name, gender').not('full_name', 'is', null).order('created_at', { ascending: false }).limit(60),
      ]);
      setStylists((st ?? []) as SimStylist[]);
      setUsers(((us ?? []) as Array<{ id: string; full_name: string | null; gender: string | null }>)
        .map(u => ({ id: u.id, name: u.full_name || 'Shopper', gender: u.gender })));
    })();
  }, []);

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

  // Styling tab — Claude generates a fresh batch of styling scenarios (paused
  // simulation cases). Same fn the weekly seeding-style-generate cron calls.
  const generateScenarios = useCallback(async () => {
    if (!supabase) return;
    setBusy('generate');
    const { data, error } = await supabase.functions.invoke('generate-style-scenarios', { body: { count: 25 } });
    setMsg(error ? `Error: ${error.message}`
      : `Generated — ${data?.inserted ?? 0} new scenarios (${data?.skipped ?? 0} dupes skipped, source: ${data?.source ?? '—'}).`);
    setBusy(null);
    await load();
  }, [load]);

  // Styling tab — turn AI-stylist chats into demand: pull the terms shoppers
  // asked stylists for that the catalog doesn't cover yet, as pending targets.
  const pullStyleDemand = useCallback(async () => {
    if (!supabase) return;
    setBusy('styledemand');
    const { data, error } = await supabase.rpc('refresh_seed_targets_from_style_chats');
    setMsg(error ? `Error: ${error.message}` : `Pulled stylist-chat demand — ${data ?? 0} missing term(s) queued.`);
    setBusy(null);
    await load();
  }, [load]);

  // Styling tab — auto-seed: sweep every scenario (both genders) and queue the
  // garments the catalog can't dress yet. Same job the daily seeding-gap-sweep
  // cron runs. Pure SQL, no Claude — the self-reliant self-heal.
  const sweepGaps = useCallback(async () => {
    if (!supabase) return;
    setBusy('sweep');
    const { data, error } = await supabase.rpc('sweep_style_gaps');
    setMsg(error ? `Error: ${error.message}` : `Gap sweep — ${data ?? 0} new gap(s) queued to Searches.`);
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
  const shown = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    let rows = filter === 'all' ? tabTargets : tabTargets.filter(t => t.status === filter);
    if (q) rows = rows.filter(t => t.term.toLowerCase().includes(q));
    return rows;
  }, [tabTargets, filter, listQuery]);

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
  useEffect(() => { setPage(0); }, [topTab, filter, listQuery, table.sort]);

  if (loading) return (
    <div className="admin-page" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '40vh', gap: 14 }}>
      <span className="admin-spinner" style={{ width: 30, height: 30 }} />
      <span className="admin-cell-muted" style={{ fontSize: 13 }}>Loading seeding…</span>
    </div>
  );

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            Seeding
            <button
              type="button"
              onClick={() => setShowInfo(true)}
              title="How seeding works"
              aria-label="How seeding works"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', border: '1px solid #d0d0d0', background: '#fff', color: '#555', cursor: 'pointer', padding: 0 }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </button>
          </h1>
          <p className="admin-page-subtitle">
            Demand-driven catalog seeding. Approve keywords/scenarios; the loop fetches, quality-gates,
            and publishes — only while the switch below is ON.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/admin/data?tab=products&filters=seeding" className="admin-btn admin-btn-secondary">
            View seeded products ({seededCount})
          </Link>
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
          {topTab === 'styling' && (
            <button className="admin-btn admin-btn-secondary" disabled={busy === 'generate'} onClick={() => void generateScenarios()}
              title="Claude generates a fresh batch of styling scenarios to simulate">
              {busy === 'generate' ? 'Generating…' : '✦ Generate scenarios'}
            </button>
          )}
          {topTab === 'styling' && (
            <button className="admin-btn admin-btn-secondary" disabled={busy === 'styledemand'} onClick={() => void pullStyleDemand()}
              title="Queue the things shoppers asked stylists for that the catalog doesn't cover yet">
              {busy === 'styledemand' ? 'Pulling…' : 'Pull stylist demand'}
            </button>
          )}
          {topTab === 'styling' && (
            <button className="admin-btn admin-btn-secondary" disabled={busy === 'sweep'} onClick={() => void sweepGaps()}
              title="Check every scenario (men + women) and queue garments the catalog can't dress yet">
              {busy === 'sweep' ? 'Sweeping…' : '⤳ Sweep gaps'}
            </button>
          )}
          {topTab === 'styling' && simSpend && (
            <span className="admin-cell-muted" style={{ fontSize: 13, alignSelf: 'center' }}
              title="Total Claude cost of all style-engine simulations">
              Sim spend: ${simSpend.total.toFixed(simSpend.total < 0.1 ? 4 : 2)} · {simSpend.runs} run{simSpend.runs === 1 ? '' : 's'}
            </span>
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

      {/* Automation — scoped to the active tab: Styling crons (scenario gen,
          stylist-chat demand, gap-sweep) vs the Searches demand/fetch pipeline.
          They run on schedule always; the gated ones only act while Seeding is
          ON. Pause/resume any here. */}
      {(() => {
        const tabCrons = crons.filter(c => topTab === 'styling' ? isStylingCron(c.jobname) : !isStylingCron(c.jobname));
        if (tabCrons.length === 0) return null;
        return (
          <div className="admin-detail-card" style={{ marginBottom: 16, colorScheme: 'light' }}>
            <div style={{ fontWeight: 600, marginBottom: 10 }}>
              Automation · {topTab === 'styling' ? 'Styling' : 'Searches'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) auto auto auto', gap: '10px 16px', alignItems: 'center', fontSize: 13 }}>
              {tabCrons.map(c => (
                <Fragment key={c.jobname}>
                  <div>{CRON_LABELS[c.jobname] || c.jobname}</div>
                  <div className="admin-cell-muted">{humanCron(c.schedule)}</div>
                  <div className="admin-cell-muted" title={c.last_run || ''}>
                    {c.last_status ? `${c.last_status} · ${timeAgo(c.last_run)}` : 'not yet run'}
                  </div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, justifySelf: 'end' }}>
                    <label className="admin-toggle" title={c.active ? 'on' : 'paused'}>
                      <input type="checkbox" checked={c.active} onChange={e => void toggleCron(c.jobname, e.target.checked)} />
                      <span className="admin-toggle-track" />
                    </label>
                    <span className="admin-cell-muted" style={{ fontSize: 11, minWidth: 38, color: c.active ? '#2563eb' : undefined }}>
                      {c.active ? 'on' : 'paused'}
                    </span>
                  </div>
                </Fragment>
              ))}
            </div>
          </div>
        );
      })()}

      {msg && <div className="admin-status-warning" style={{ margin: '8px 0', fontSize: 13 }}>{msg}</div>}

      {/* Top tabs: Searches | Styling */}
      <div className="admin-tabs">
        <button className={`admin-tab ${topTab === 'searches' ? 'active' : ''}`} onClick={() => setTopTab('searches')}>
          Searches<span className="admin-tab-badge">{searchTargets.length}</span>
        </button>
        <button className={`admin-tab ${topTab === 'styling' ? 'active' : ''}`} onClick={() => setTopTab('styling')}>
          Styling<span className="admin-tab-badge">{stylingTargets.length}</span>
        </button>
        <button
          type="button"
          onClick={() => setShowStyleInfo(true)}
          title="How styling works"
          aria-label="How styling works"
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', border: '1px solid #d0d0d0', background: '#fff', color: '#555', cursor: 'pointer', padding: 0, alignSelf: 'center', marginLeft: 4 }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
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

      {/* Keyword search within the current list */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, colorScheme: 'light' }}>
        <input
          className="admin-date-input"
          placeholder={`Search ${topTab === 'styling' ? 'scenarios' : 'this list'} by keyword…`}
          value={listQuery}
          onChange={e => setListQuery(e.target.value)}
          style={{ width: '100%', maxWidth: 360 }}
        />
        {listQuery.trim() && (
          <span className="admin-cell-muted" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
            {shown.length} match{shown.length === 1 ? '' : 'es'}
          </span>
        )}
      </div>

      {/* Targets table */}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              {topTab === 'styling' ? (
                <>
                  <SortableTh label="Scenario" sortKey="term" currentSort={table.sort} onSort={table.handleSort} />
                  <th className="admin-th-center">Gender</th>
                  <th className="admin-th-center">Formality</th>
                  <th>Slots</th>
                  <th className="admin-th-center">Simulated</th>
                  <SortableTh label="Status" sortKey="status" currentSort={table.sort} onSort={table.handleSort} />
                  <th>Actions</th>
                </>
              ) : (
                <>
                  <SortableTh label="Target" sortKey="term" currentSort={table.sort} onSort={table.handleSort} />
                  <SortableTh label="Demand" sortKey="search_hits" currentSort={table.sort} onSort={table.handleSort} className="admin-th-center" />
                  <SortableTh label="Status" sortKey="status" currentSort={table.sort} onSort={table.handleSort} />
                  <SortableTh label="Priority" sortKey="priority" currentSort={table.sort} onSort={table.handleSort} className="admin-th-center" />
                  <SortableTh label="Last run" sortKey="last_run_at" currentSort={table.sort} onSort={table.handleSort} />
                  <SortableTh label="Found" sortKey="products_found" currentSort={table.sort} onSort={table.handleSort} className="admin-th-center" />
                  <SortableTh label="Published" sortKey="products_published" currentSort={table.sort} onSort={table.handleSort} className="admin-th-center" />
                  <th>Actions</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {paged.map(t => topTab === 'styling' ? (
              <tr key={t.id}>
                <td className="admin-cell-name">
                  <button type="button" onClick={() => setProductsScenario(t)}
                    title="See every catalog product available for this scenario"
                    style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: '#2563eb', textDecoration: 'underline', cursor: 'pointer', textAlign: 'left' }}>
                    {t.term}
                  </button>
                </td>
                <td className="admin-cell-center">{String(t.intent?.gender ?? '—')}</td>
                <td className="admin-cell-center">{t.intent?.formality != null ? String(t.intent?.formality) : '—'}</td>
                <td className="admin-cell-muted" style={{ fontSize: 12 }}>{Array.isArray(t.intent?.slots) ? (t.intent?.slots as string[]).join(' / ') : '—'}</td>
                <td className="admin-cell-center">{t.last_result ? <span style={{ color: '#0d9488' }}>✓</span> : '—'}</td>
                <td><span className={`admin-status-dot admin-status-dot--${statusDotKind(t.status)}`} /> {t.status}</td>
                <td style={{ whiteSpace: 'nowrap', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="admin-btn admin-btn-primary admin-row-promote" onClick={() => setSimScenario(t)}
                    title="Run the stylist engine on this scenario">{t.last_result ? '▶ Re-simulate' : '▶ Simulate'}</button>
                  {t.status !== 'approved' && <button className="admin-btn admin-btn-secondary admin-row-promote" onClick={() => void setStatus(t.id, 'approved')}>Approve</button>}
                  {t.status !== 'rejected' && <button className="admin-btn admin-btn-secondary admin-row-promote" onClick={() => void setStatus(t.id, 'rejected')}>Reject</button>}
                </td>
              </tr>
            ) : (
              <tr key={t.id}>
                <td className="admin-cell-name">
                  <Link to={`/admin/data?tab=products&filters=seeding&target=${t.id}&label=${encodeURIComponent(t.term)}`}
                    title="View this target's products">{t.term}</Link>
                </td>
                <td className="admin-cell-center">{t.search_hits}{t.zero_result && <span title="returned nothing" style={{ color: '#ea4335' }}> ⚑</span>}</td>
                <td><span className={`admin-status-dot admin-status-dot--${statusDotKind(t.status)}`} /> {t.status}</td>
                <td className="admin-cell-center">{t.priority}</td>
                <td className="admin-cell-muted">{timeAgo(t.last_run_at)}</td>
                <td className="admin-cell-center">
                  {t.products_found > 0
                    ? <Link to={`/admin/data?tab=products&filters=seeding&target=${t.id}&label=${encodeURIComponent(t.term)}`} title="View the products this target fetched">{t.products_found}</Link>
                    : 0}
                </td>
                <td className="admin-cell-center">{t.products_published}</td>
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

      {table.sortedData.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginTop: 12, fontSize: 13 }}>
          <span className="admin-cell-muted">{table.sortedData.length} {topTab === 'styling' ? 'scenarios' : 'targets'} · page {pageSafe + 1} of {pageCount}</span>
          <button className="admin-btn admin-btn-secondary" disabled={pageSafe === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Prev</button>
          <button className="admin-btn admin-btn-secondary" disabled={pageSafe >= pageCount - 1} onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}>Next</button>
        </div>
      )}

      {showStyleInfo && <StyleInfoModal onClose={() => setShowStyleInfo(false)} />}

      {productsScenario && (
        <ScenarioProductsModal
          scenario={{ term: productsScenario.term, intent: productsScenario.intent }}
          onClose={() => setProductsScenario(null)}
        />
      )}

      {simScenario && (
        <StyleSimulateModal
          scenario={{ id: simScenario.id, term: simScenario.term, intent: simScenario.intent, last_result: simScenario.last_result }}
          stylists={stylists}
          users={users}
          spend={simSpend ?? undefined}
          onClose={() => setSimScenario(null)}
          onChanged={() => void load()}
        />
      )}

      {showInfo && (
        <div className="admin-modal-overlay" onClick={() => setShowInfo(false)}>
          <div className="admin-modal admin-modal-wide" onClick={e => e.stopPropagation()} style={{ maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <div className="admin-modal-header">
              <h3>How seeding works</h3>
              <button className="admin-modal-close" onClick={() => setShowInfo(false)}>&times;</button>
            </div>
            <div className="admin-modal-body" style={{ overflow: 'auto', fontSize: 14, lineHeight: 1.55 }}>
              <p style={{ marginTop: 0 }}>
                Seeding turns <strong>real shopper demand</strong> into live catalog products — automatically,
                behind a quality gate. Here is the full pipeline and the tech behind each step.
              </p>

              <h4 style={{ marginBottom: 6 }}>Follow one keyword: “white shoes”</h4>
              <ol style={{ marginTop: 0, paddingLeft: 18 }}>
                <li>A shopper types <em>“white shoes”</em> in the app → it’s logged to the <code>search_logs</code> table (by the <code>search-log-batch</code> function).</li>
                <li>Hourly, <code>refresh_seed_targets_from_searches()</code> rolls every search up into this queue (<code>seed_targets</code>), ranked by how often it was searched — and boosted if it returned nothing.</li>
                <li>The auto-curate job (<code>seed-curate</code>) sends pending terms to <strong>Claude (Haiku)</strong>, which marks “white shoes” <em>valid → approved</em> and gibberish like “fff” <em>→ rejected</em>.</li>
                <li>The orchestrator (<code>seed-run</code>) picks up the approved target and calls <code>product-search</code>, which queries <strong>SerpAPI’s Google Shopping</strong> engine, then hits Google’s <em>immersive-product</em> API to resolve each result’s real merchant URL + image gallery.</li>
                <li>~20 products are written to the <code>products</code> table — held <code>is_active=false</code>, tagged <code>source=seed_serpapi</code> and linked to this target (<code>seed_target_id</code>).</li>
                <li><code>enrich-occasions</code> sends each product to <strong>Claude (Haiku)</strong> for occasion tags (e.g. <em>["running","gym","casual"]</em>); <code>embed-product</code> generates vector embeddings for semantic search.</li>
                <li>The activation job runs <code>product_ready_for_feed()</code> — has a real image <strong>and</strong> occasion text? — and flips the passers to <code>is_active=true</code>. They’re now live in the feed &amp; search.</li>
              </ol>

              <h4 style={{ marginBottom: 6 }}>Under the hood</h4>
              <table className="admin-table" style={{ marginBottom: 8 }}>
                <thead><tr><th>Stage</th><th>Component</th><th>Tech</th></tr></thead>
                <tbody>
                  <tr><td>Log a search</td><td><code>search-log-batch</code></td><td>→ <code>search_logs</code></td></tr>
                  <tr><td>Build the queue</td><td><code>refresh_seed_targets_from_searches()</code></td><td>SQL aggregate</td></tr>
                  <tr><td>Curate</td><td><code>seed-curate</code></td><td>Claude Haiku</td></tr>
                  <tr><td>Expand a scenario</td><td><code>catalog-brainstorm</code></td><td>Claude → per-garment queries</td></tr>
                  <tr><td>Fetch products</td><td><code>product-search</code></td><td>SerpAPI Google Shopping + immersive</td></tr>
                  <tr><td>Enrich</td><td><code>enrich-occasions</code></td><td>Claude Haiku → occasion tags</td></tr>
                  <tr><td>Embed</td><td><code>embed-product</code></td><td>vector embeddings</td></tr>
                  <tr><td>Gate &amp; publish</td><td><code>product_ready_for_feed()</code> + activation</td><td>Postgres + pg_cron</td></tr>
                </tbody>
              </table>
              <p className="admin-cell-muted" style={{ marginTop: 0 }}>
                Each step is a <strong>Supabase edge function</strong> (Deno). Scheduling is <strong>pg_cron</strong>;
                the jobs call the edge functions over HTTP via <strong>pg_net</strong> with a vault service token.
              </p>

              <h4 style={{ marginBottom: 6 }}>Two demand sources</h4>
              <ul style={{ marginTop: 0 }}>
                <li><strong>Searches</strong> — keywords (<em>“white shoes”</em>) → searched directly on SerpAPI.</li>
                <li><strong>Styling</strong> — scenarios (<em>“beach trip”</em>) → first expanded by <code>catalog-brainstorm</code> into one query per garment (top, bottom, shoes, bag…), then each searched.</li>
              </ul>

              <h4 style={{ marginBottom: 6 }}>Automation (pg_cron)</h4>
              <table className="admin-table" style={{ marginBottom: 12 }}>
                <thead><tr><th>Job</th><th>Calls</th><th>Runs</th><th>Spends $ / changes feed?</th></tr></thead>
                <tbody>
                  <tr><td>Auto-curate</td><td><code>seed-curate</code></td><td>10 min</td><td>no</td></tr>
                  <tr><td>Pull demand</td><td><code>refresh…()</code></td><td>hourly</td><td>no</td></tr>
                  <tr><td>Fetch</td><td><code>seed-run</code></td><td>30 min</td><td><strong>spends</strong> — only while ON</td></tr>
                  <tr><td>Enrich</td><td><code>enrich-occasions</code></td><td>15 min</td><td>only while ON</td></tr>
                  <tr><td>Publish</td><td><code>run_seeding_activation()</code></td><td>15 min</td><td>only while ON</td></tr>
                </tbody>
              </table>

              <h4 style={{ marginBottom: 6 }}>Safeguards &amp; controls</h4>
              <ul style={{ marginTop: 0, marginBottom: 0 }}>
                <li><strong>Quality gate</strong> — live only with a real image + occasion text; demand never lowers the bar.</li>
                <li><strong>Pause / Enable everything</strong> — one switch stops/starts the loop <em>and</em> every cron.</li>
                <li><strong>Budget cap</strong> — limits monthly SerpAPI spend; fetching stops when it’s hit.</li>
                <li><strong>Deletable</strong> — every seeded product carries <code>source=seed_serpapi</code>, so “Purge seeded” removes them cleanly.</li>
                <li>Click any <strong>target</strong> (or its Found count) to see exactly the products it fetched.</li>
              </ul>
            </div>
            <div className="admin-modal-footer">
              <button className="admin-btn admin-btn-primary" onClick={() => setShowInfo(false)}>Got it</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
