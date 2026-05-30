// API Explorer & diagnostics tab — fire any allowlisted GET (or POST
// /links) against the upstream and inspect the raw + normalized response.
// Useful for discovering the real affiliate.com response schema and for
// verifying the AFFILIATE_COM_API_KEY secret end-to-end.

import { useState } from 'react';
import { affiliateCom } from '~/services/affiliate-com';
import { ConnectionPill, ErrorBanner, Spinner, GenericTable } from './shared';

const PRESETS: { label: string; path: string }[] = [
  { label: 'Account', path: '/v1/account' },
  { label: 'Networks', path: '/v1/networks?per_page=10' },
  { label: 'Network groups', path: '/v1/network-groups' },
  { label: 'Merchants', path: '/v1/merchants?per_page=10' },
  { label: 'Merchant search', path: '/v1/merchants?search=nike&per_page=10' },
];

export default function ExplorerTab() {
  const [path, setPath] = useState('/merchants?per_page=10');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<unknown>(null);
  const [list, setList] = useState<unknown[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);

  const run = async (p?: string) => {
    const target = (p ?? path).trim();
    if (!target.startsWith('/')) { setError('path must start with /'); return; }
    setLoading(true); setError(null); setData(null); setList(null); setStatus(null);
    const r = await affiliateCom.raw({ path: target });
    setLoading(false);
    setStatus(r.status ?? null);
    if (!r.success) { setError(r.error); return; }
    setData(r.data);
    setList(Array.isArray(r.list?.items) ? r.list!.items : null);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>API explorer &amp; diagnostics</h2>
        <ConnectionPill />
      </div>

      <p style={{ margin: '0 0 12px', fontSize: 12, color: '#64748b' }}>
        Sends an allowlisted <code>GET</code> against <code>api.affiliate.com</code> through the edge function — the key stays
        server-side. Product search (<code>POST /v1/products</code>) and conversion live in their own tabs.
      </p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {PRESETS.map(p => (
          <button key={p.path} type="button" className="admin-btn admin-btn-secondary" style={{ fontSize: 11 }}
            onClick={() => { setPath(p.path); run(p.path); }}>
            {p.label}
          </button>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); run(); }} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <span style={{ alignSelf: 'center', fontSize: 13, color: '#94a3b8', fontFamily: 'monospace' }}>api.affiliate.com</span>
        <input type="text" value={path} onChange={e => setPath(e.target.value)}
          style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 13, fontFamily: 'monospace' }}
          placeholder="/merchants?per_page=10" />
        <button type="submit" className="admin-btn admin-btn-primary" style={{ fontSize: 13 }} disabled={loading}>
          {loading ? 'Sending…' : 'Send'}
        </button>
      </form>

      {status != null && (
        <div style={{ fontSize: 12, color: status >= 200 && status < 300 ? '#16a34a' : '#dc2626', marginBottom: 8 }}>
          HTTP {status}
        </div>
      )}
      <ErrorBanner error={error} />
      {loading && <Spinner label="Calling upstream…" />}

      {list && list.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Normalized rows ({list.length}):</div>
          <GenericTable rows={list} maxCols={8} />
        </div>
      )}

      {data != null && (
        <div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Raw response:</div>
          <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: 14, borderRadius: 8, fontSize: 12, overflow: 'auto', maxHeight: 480 }}>
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
