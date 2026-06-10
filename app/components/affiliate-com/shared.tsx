// Shared primitives for the Affiliate.com admin tabs.
//
// Keeps the per-tab files focused on their domain by centralizing the
// async-call hook, connection pill, pagination, generic adaptive table,
// raw-JSON drawer, and small presentational helpers.

import { useState, useEffect, useCallback, useRef } from 'react';
import { affiliateCom, inferColumns, cellValue, type AffiliateResult } from '~/services/affiliate-com';

// ── async hook ──────────────────────────────────────────────────────
// Runs an affiliate-com call, tracks loading/error, and re-runs when the
// `deps` change. `run` lets a tab trigger manually (e.g. on submit).

export function useAffiliateCall<T>(
  fn: () => Promise<AffiliateResult<T>>,
  deps: unknown[],
  opts: { auto?: boolean } = { auto: true },
) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AffiliateResult<T> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    setLoading(true);
    const r = await fnRef.current();
    setResult(r);
    setLoading(false);
    return r;
  }, []);

  useEffect(() => {
    if (opts.auto === false) return;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { loading, result, run, setResult };
}

// ── connection pill (live ping) ─────────────────────────────────────

export function ConnectionPill({ compact }: { compact?: boolean }) {
  const [state, setState] = useState<'idle' | 'testing' | 'ok' | 'err'>('idle');
  const [msg, setMsg] = useState<string | null>(null);

  const ping = useCallback(async () => {
    setState('testing'); setMsg(null);
    const r = await affiliateCom.ping();
    if (r.success) {
      setState('ok');
      const c = (r.data as { sample_count?: number } | null)?.sample_count;
      setMsg(typeof c === 'number' ? `${c} sample` : null);
    } else {
      setState('err');
      setMsg(r.error);
    }
  }, []);

  useEffect(() => { ping(); }, [ping]);

  const badge =
    state === 'ok'
      ? <span className="admin-status admin-status-online">Connected{!compact && msg ? ` · ${msg}` : ''}</span>
      : state === 'err'
        ? <span className="admin-status" style={{ color: '#dc2626' }}>Not connected{!compact && msg ? ` · ${msg}` : ''}</span>
        : <span className="admin-status" style={{ color: '#f59e0b' }}>Checking…</span>;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {badge}
      <button type="button" className="admin-btn admin-btn-secondary" style={{ fontSize: 12 }}
        disabled={state === 'testing'} onClick={ping}>
        {state === 'testing' ? 'Testing…' : 'Retest'}
      </button>
    </span>
  );
}

// ── error / empty / loading ─────────────────────────────────────────

export function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;
  const notConfigured = /not configured/i.test(error);
  return (
    <div style={{
      background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
      padding: '10px 14px', color: '#b91c1c', fontSize: 13, margin: '8px 0',
    }}>
      <strong>{notConfigured ? 'API key not configured.' : 'Request failed.'}</strong>{' '}
      {notConfigured
        ? 'Add AFFILIATE_COM_API_KEY in Supabase → Edge Functions → Secrets, then retry.'
        : error}
    </div>
  );
}

export function EmptyState({ label }: { label: string }) {
  return (
    <div style={{ padding: '28px 16px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
      {label}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div style={{ padding: '24px 16px', color: '#64748b', fontSize: 13 }}>{label}</div>;
}

// ── pagination ──────────────────────────────────────────────────────

export function Pagination({ page, perPage, total, onPage }: {
  page: number; perPage: number; total: number | null; onPage: (p: number) => void;
}) {
  const hasMore = total != null ? page * perPage < total : undefined;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', padding: '10px 0', fontSize: 12, color: '#64748b' }}>
      {total != null && <span>{total.toLocaleString()} total</span>}
      <button type="button" className="admin-btn admin-btn-secondary" style={{ fontSize: 12 }}
        disabled={page <= 1} onClick={() => onPage(page - 1)}>← Prev</button>
      <span>Page {page}</span>
      <button type="button" className="admin-btn admin-btn-secondary" style={{ fontSize: 12 }}
        disabled={hasMore === false} onClick={() => onPage(page + 1)}>Next →</button>
    </div>
  );
}

// ── adaptive generic table ──────────────────────────────────────────
// Renders any array of objects by inferring columns. A row click opens
// the raw-JSON drawer so nothing is ever hidden from the admin.

export function GenericTable({ rows, columns, onRowClick, maxCols = 6 }: {
  rows: unknown[];
  columns?: string[];
  onRowClick?: (row: unknown) => void;
  maxCols?: number;
}) {
  if (!rows || rows.length === 0) return <EmptyState label="No rows returned." />;
  const cols = columns ?? inferColumns(rows, maxCols);
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>{cols.map(c => <th key={c} style={{ textAlign: 'left', textTransform: 'capitalize' }}>{c.replace(/_/g, ' ')}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} onClick={() => onRowClick?.(r)} style={{ cursor: onRowClick ? 'pointer' : 'default' }}>
              {cols.map(c => (
                <td key={c} style={{ textAlign: 'left', fontSize: 12, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {cellValue(r, c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── raw JSON drawer ─────────────────────────────────────────────────

export function JsonDrawer({ title, value, onClose }: { title: string; value: unknown; onClose: () => void }) {
  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" style={{ width: 560, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>
          <button className="admin-modal-close" onClick={onClose} style={{ fontSize: 22 }}>×</button>
        </div>
        <pre style={{
          margin: 0, padding: '16px 20px', overflow: 'auto', flex: 1, fontSize: 12,
          background: '#0f172a', color: '#e2e8f0', lineHeight: 1.5,
        }}>
          {JSON.stringify(value, null, 2)}
        </pre>
      </div>
    </div>
  );
}

// ── KPI card ────────────────────────────────────────────────────────

export function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="admin-stat-card">
      <span className="admin-stat-value">{value}</span>
      <span className="admin-stat-label">{label}</span>
      {sub && <span style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{sub}</span>}
    </div>
  );
}

// ── search / toolbar input ──────────────────────────────────────────

export function SearchBar({ value, onChange, onSubmit, placeholder }: {
  value: string; onChange: (v: string) => void; onSubmit: () => void; placeholder: string;
}) {
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}
    >
      <input
        type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ flex: 1, minWidth: 200, padding: '8px 12px', borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 13 }}
      />
      <button type="submit" className="admin-btn admin-btn-primary" style={{ fontSize: 13 }}>Search</button>
    </form>
  );
}
