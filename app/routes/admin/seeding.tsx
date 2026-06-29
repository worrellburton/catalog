// Admin · Seeding — control panel for demand-driven catalog seeding.
// Lists every seed target (search keywords + scenarios), lets the operator
// curate (approve/pause/reject), flip the global kill-switch, set the budget,
// refresh demand from search_logs, and run a target on demand. The loop only
// spends/publishes while the kill-switch is ON. See docs/CATALOG_SEEDING.md.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '@remix-run/react';
import { supabase } from '~/utils/supabase';

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

const STATUSES = ['pending', 'approved', 'paused', 'rejected', 'done'] as const;
const STATUS_COLOR: Record<string, string> = {
  pending: '#9aa0a6', approved: '#34a853', paused: '#fbbc04', rejected: '#ea4335', done: '#4285f4',
};

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3.6e6);
  if (h < 1) return `${Math.max(1, Math.floor(diff / 6e4))}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function SeedingPage() {
  const [targets, setTargets] = useState<SeedTarget[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [cap, setCap] = useState(0);
  const [used, setUsed] = useState(0);
  const [seededCount, setSeededCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [newTerm, setNewTerm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [{ data: rows }, { data: settings }, { count: seeded }] = await Promise.all([
      supabase.from('seed_targets').select('*').order('priority', { ascending: false }).limit(1000),
      supabase.from('app_settings').select('key, value')
        .in('key', ['seeding_enabled', 'seeding_monthly_serpapi_cap', 'seeding_serpapi_used_month']),
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('source', 'seed_serpapi'),
    ]);
    setTargets((rows ?? []) as SeedTarget[]);
    const map = new Map((settings ?? []).map(s => [s.key, s.value] as [string, string]));
    setEnabled(map.get('seeding_enabled') === 'true');
    setCap(Number(map.get('seeding_monthly_serpapi_cap') || '0'));
    setUsed(Number(map.get('seeding_serpapi_used_month') || '0'));
    setSeededCount(seeded ?? 0);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const setSetting = useCallback(async (key: string, value: string) => {
    if (!supabase) return;
    const { error } = await supabase.rpc('admin_set_seeding_setting', { p_key: key, p_value: value });
    if (error) setMsg(`Error: ${error.message}`);
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
    const kind = term.split(/\s+/).length >= 4 ? 'scenario' : 'manual';
    const { error } = await supabase.from('seed_targets')
      .insert({ term: term.toLowerCase(), kind, status: 'approved', priority: 50 });
    setMsg(error ? `Error: ${error.message}` : `Added "${term}" as ${kind}.`);
    setNewTerm('');
    await load();
  }, [newTerm, load]);

  const shown = useMemo(
    () => (filter === 'all' ? targets : targets.filter(t => t.status === filter)),
    [targets, filter],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: targets.length };
    for (const s of STATUSES) c[s] = targets.filter(t => t.status === s).length;
    return c;
  }, [targets]);

  if (loading) return <div className="admin-page"><p>Loading seeding…</p></div>;

  return (
    <div className="admin-page" style={{ padding: 24, maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Seeding</h1>
        <Link to="/admin/seeding/simulate" className="admin-btn" style={{ textDecoration: 'none' }}>
          ▶ Simulate
        </Link>
      </div>
      <p style={{ color: '#9aa0a6', marginTop: 4 }}>
        Demand-driven catalog seeding. Approve keywords/scenarios; the loop fetches, quality-gates, and publishes —
        only while the switch below is ON.
      </p>

      {/* Kill-switch + budget */}
      <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap', padding: '14px 16px', border: '1px solid #2a2a2a', borderRadius: 10, margin: '12px 0' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={enabled} onChange={e => void setSetting('seeding_enabled', e.target.checked ? 'true' : 'false')} />
          <strong style={{ color: enabled ? '#34a853' : '#ea4335' }}>{enabled ? 'Seeding ON' : 'Seeding OFF'}</strong>
        </label>
        <div>
          Budget: <strong>{used}</strong> / {cap} SerpAPI searches this month
          {cap > 0 && used >= cap && <span style={{ color: '#ea4335' }}> · cap reached</span>}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Cap:
          <input type="number" defaultValue={cap} style={{ width: 90 }}
            onBlur={e => { const v = e.target.value; if (Number(v) !== cap) void setSetting('seeding_monthly_serpapi_cap', String(Math.max(0, Number(v) || 0))); }} />
        </label>
        <button className="admin-btn" onClick={() => void setSetting('seeding_serpapi_used_month', '0')}>Reset budget</button>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '12px 0' }}>
        <button className="admin-btn" disabled={busy === 'refresh'} onClick={() => void refreshFromSearches()}>
          {busy === 'refresh' ? 'Refreshing…' : 'Refresh from searches'}
        </button>
        <input placeholder="Add a keyword or scenario…" value={newTerm}
          onChange={e => setNewTerm(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void addTarget(); }}
          style={{ flex: '1 1 240px', minWidth: 200 }} />
        <button className="admin-btn" onClick={() => void addTarget()} disabled={!newTerm.trim()}>Add</button>
        <button className="admin-btn" disabled={busy === 'purge' || seededCount === 0} onClick={() => void purgeSeeded()}
          title="Delete every product seeded by this loop (source=seed_serpapi)">
          {busy === 'purge' ? 'Purging…' : `Purge seeded (${seededCount})`}
        </button>
      </div>

      {msg && <div style={{ padding: '8px 12px', background: '#1a2733', borderRadius: 8, margin: '8px 0', fontSize: 13 }}>{msg}</div>}

      {/* Status filter */}
      <div style={{ display: 'flex', gap: 8, margin: '12px 0', flexWrap: 'wrap' }}>
        {(['all', ...STATUSES] as string[]).map(s => (
          <button key={s} onClick={() => setFilter(s)}
            style={{ padding: '4px 10px', borderRadius: 14, border: '1px solid #333', cursor: 'pointer',
              background: filter === s ? '#2a3f5f' : 'transparent', color: '#ddd', fontSize: 13 }}>
            {s} ({counts[s] ?? 0})
          </button>
        ))}
      </div>

      {/* Table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: '#9aa0a6', borderBottom: '1px solid #2a2a2a' }}>
            <th style={{ padding: 8 }}>Target</th>
            <th>Kind</th><th>Demand</th><th>Pri</th><th>Status</th><th>Last run</th><th>Found</th><th>Pub</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(t => (
            <tr key={t.id} style={{ borderBottom: '1px solid #1c1c1c' }}>
              <td style={{ padding: 8, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.term}</td>
              <td>{t.kind}</td>
              <td>{t.search_hits}{t.zero_result && <span title="returned nothing" style={{ color: '#ea4335' }}> ⚑</span>}</td>
              <td>{t.priority}</td>
              <td><span style={{ color: STATUS_COLOR[t.status] }}>{t.status}</span></td>
              <td>{timeAgo(t.last_run_at)}</td>
              <td>{t.products_found}</td>
              <td>{t.products_published}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {t.status !== 'approved' && <button className="admin-btn-sm" onClick={() => void setStatus(t.id, 'approved')}>Approve</button>}
                {t.status !== 'paused' && <button className="admin-btn-sm" onClick={() => void setStatus(t.id, 'paused')}>Pause</button>}
                {t.status !== 'rejected' && <button className="admin-btn-sm" onClick={() => void setStatus(t.id, 'rejected')}>Reject</button>}
                {t.status === 'approved' && <button className="admin-btn-sm" disabled={busy === t.id} onClick={() => void runNow(t.id)}>{busy === t.id ? '…' : 'Run'}</button>}
              </td>
            </tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={9} style={{ padding: 16, color: '#9aa0a6' }}>No targets.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
