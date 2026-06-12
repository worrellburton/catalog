// /d/<slug> — a shared document behind its own password. Links are
// minted from /admin/model → Share → "Share with a link" (each carries
// its own passcode and can be revoked). The passcode is verified
// server-side by the open_document_share RPC (security definer), which
// also counts the view and returns the snapshot HTML — the share table
// itself is never readable from the client.

import { useEffect, useState } from 'react';
import { useParams } from '@remix-run/react';
import { supabase } from '~/utils/supabase';

export default function SharedDocument() {
  const { slug } = useParams();
  const [code, setCode] = useState('');
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [html, setHtml] = useState<string | null>(null);

  // Pinch-zoom like a PDF (same override the /business-plan viewer uses).
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    const prev = meta?.getAttribute('content') ?? null;
    meta?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=6, user-scalable=yes');
    return () => { if (prev !== null) meta?.setAttribute('content', prev); };
  }, []);

  const submit = async () => {
    if (!supabase || !slug || busy || !code.trim()) return;
    setBusy(true);
    const { data } = await supabase.rpc('open_document_share', { p_slug: slug, p_pass: code });
    setBusy(false);
    if (typeof data === 'string' && data) setHtml(data);
    else setErr(true);
  };

  if (html) {
    return (
      <iframe
        title="Catalog — shared document"
        srcDoc={html}
        style={{ display: 'block', width: '100%', height: '100vh', border: 'none', background: '#f0efe9' }}
      />
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0c', padding: 24 }}>
      <div style={{ width: 320, textAlign: 'center', color: '#fff', fontFamily: 'Helvetica Neue, sans-serif' }}>
        <p style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#8b8b94', margin: '0 0 10px' }}>
          Catalog · Shared document
        </p>
        <input
          type="password"
          value={code}
          autoFocus
          placeholder="Password"
          onChange={e => { setCode(e.target.value); setErr(false); }}
          onKeyDown={e => { if (e.key === 'Enter') void submit(); }}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '13px 16px', borderRadius: 10,
            border: `1px solid ${err ? '#ef4444' : 'rgba(255,255,255,0.2)'}`,
            background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 15,
            textAlign: 'center', letterSpacing: '0.2em', outline: 'none', fontFamily: 'inherit',
          }}
        />
        {err && <p style={{ color: '#f87171', fontSize: 12, marginTop: 8 }}>That&rsquo;s not it — or this link was closed.</p>}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          style={{ marginTop: 12, width: '100%', padding: '12px 0', borderRadius: 10, border: 'none', background: '#fff', color: '#0a0a0c', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', opacity: busy ? 0.6 : 1 }}
        >
          {busy ? 'Opening…' : 'Open'}
        </button>
      </div>
    </div>
  );
}
