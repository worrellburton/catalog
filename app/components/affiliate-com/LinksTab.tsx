// Deep-link generator tab — turn any destination URL into a monetized
// affiliate tracking link, with optional SubID for attribution. The
// result is click-to-copy.

import { useState } from 'react';
import { affiliateCom } from '~/services/affiliate-com';
import { ErrorBanner } from './shared';

function extractLink(data: unknown): string | null {
  if (!data) return null;
  if (typeof data === 'string') return data;
  const d = data as Record<string, unknown>;
  const cand = d.link ?? d.url ?? d.deep_link ?? d.tracking_url ?? d.short_url;
  return typeof cand === 'string' ? cand : null;
}

export default function LinksTab() {
  const [url, setUrl] = useState('');
  const [subId, setSubId] = useState('');
  const [merchantId, setMerchantId] = useState('');
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [link, setLink] = useState<string | null>(null);
  const [raw, setRaw] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    if (!url.trim()) return;
    setState('working'); setError(null); setLink(null); setRaw(null);
    const r = await affiliateCom.generateLink({
      url: url.trim(),
      sub_id: subId.trim() || undefined,
      merchant_id: merchantId.trim() || undefined,
    });
    if (!r.success) { setState('error'); setError(r.error); return; }
    setRaw(r.data);
    const l = extractLink(r.data);
    setLink(l);
    setState('done');
  };

  const copy = () => {
    if (!link) return;
    try { navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>Deep-link generator</h2>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: '#64748b' }}>
        Convert any merchant product/landing URL into a monetized affiliate tracking link.
      </p>

      <form onSubmit={(e) => { e.preventDefault(); generate(); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ fontSize: 12, fontWeight: 600 }}>
          Destination URL
          <input
            type="url" required value={url} onChange={e => setUrl(e.target.value)}
            placeholder="https://merchant.com/product/123"
            style={{ width: '100%', marginTop: 4, padding: '9px 12px', borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 13, boxSizing: 'border-box' }}
          />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600 }}>
            SubID <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional)</span>
            <input type="text" value={subId} onChange={e => setSubId(e.target.value)} placeholder="campaign-or-user tag"
              style={{ width: '100%', marginTop: 4, padding: '9px 12px', borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 13, boxSizing: 'border-box' }} />
          </label>
          <label style={{ fontSize: 12, fontWeight: 600 }}>
            Merchant ID <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional)</span>
            <input type="text" value={merchantId} onChange={e => setMerchantId(e.target.value)} placeholder="if known"
              style={{ width: '100%', marginTop: 4, padding: '9px 12px', borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 13, boxSizing: 'border-box' }} />
          </label>
        </div>
        <button type="submit" className="admin-btn admin-btn-primary" style={{ alignSelf: 'flex-start', fontSize: 13 }} disabled={state === 'working'}>
          {state === 'working' ? 'Generating…' : 'Generate link'}
        </button>
      </form>

      <ErrorBanner error={error} />

      {state === 'done' && (
        <div style={{ marginTop: 16 }}>
          {link ? (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 700, marginBottom: 6 }}>AFFILIATE LINK</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <code style={{ flex: 1, fontSize: 12, wordBreak: 'break-all', background: '#fff', padding: '8px 10px', borderRadius: 6, border: '1px solid #d1fae5' }}>{link}</code>
                <button type="button" className="admin-btn admin-btn-primary" style={{ fontSize: 12 }} onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Link field not recognized — raw response:</div>
              <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: 12, borderRadius: 8, fontSize: 12, overflow: 'auto' }}>{JSON.stringify(raw, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
