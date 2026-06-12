// /business-plan — the public business-plan viewer. Passcode-gated (Shopmix),
// works on mobile and desktop, scrolls like a PDF and allows pinch-zoom
// (this route re-enables user scaling). The document itself is the
// latest snapshot the admin generated from /admin/model (documents
// table, key 'business-plan') rendered in an isolated iframe so its
// print stylesheet can't collide with the app's.

import { useEffect, useState } from 'react';
import { supabase } from '~/utils/supabase';

const PASS_KEY = 'plan-pass-ok';

export default function PlanViewer() {
  const [ok, setOk] = useState(false);
  const [code, setCode] = useState('');
  const [err, setErr] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    try { if (sessionStorage.getItem(PASS_KEY) === '1') setOk(true); } catch { /* private mode */ }
  }, []);

  // Pinch-zoom: the app's viewport meta may pin scaling — this document
  // should zoom like a PDF, so allow it here and restore on leave.
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    const prev = meta?.getAttribute('content') ?? null;
    meta?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=6, user-scalable=yes');
    return () => { if (prev !== null) meta?.setAttribute('content', prev); };
  }, []);

  useEffect(() => {
    if (!ok || !supabase) return;
    void supabase
      .from('documents')
      .select('html')
      .eq('key', 'business-plan')
      .maybeSingle()
      .then(({ data }) => {
        if (data?.html) setHtml((data as { html: string }).html);
        else setMissing(true);
      });
  }, [ok]);

  const submit = () => {
    if (code.trim().toLowerCase() === 'shopmix') {
      setOk(true);
      try { sessionStorage.setItem(PASS_KEY, '1'); } catch { /* private mode */ }
    } else {
      setErr(true);
    }
  };

  if (!ok) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0c', padding: 24 }}>
        <div style={{ width: 320, textAlign: 'center', color: '#fff', fontFamily: 'Helvetica Neue, sans-serif' }}>
          <p style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#8b8b94', margin: '0 0 10px' }}>Catalog · Business Plan</p>
          <input
            type="password"
            value={code}
            autoFocus
            placeholder="Passcode"
            onChange={e => { setCode(e.target.value); setErr(false); }}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '13px 16px', borderRadius: 10,
              border: `1px solid ${err ? '#ef4444' : 'rgba(255,255,255,0.2)'}`,
              background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 15,
              textAlign: 'center', letterSpacing: '0.2em', outline: 'none', fontFamily: 'inherit',
            }}
          />
          {err && <p style={{ color: '#f87171', fontSize: 12, marginTop: 8 }}>That&rsquo;s not it.</p>}
          <button
            type="button"
            onClick={submit}
            style={{ marginTop: 12, width: '100%', padding: '12px 0', borderRadius: 10, border: 'none', background: '#fff', color: '#0a0a0c', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Open
          </button>
        </div>
      </div>
    );
  }

  if (missing) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0c', color: '#8b8b94', fontFamily: 'Helvetica Neue, sans-serif', fontSize: 14, textAlign: 'center', padding: 24 }}>
        No plan published yet — open it once from /admin/model and it lands here automatically.
      </div>
    );
  }

  if (!html) {
    return <div style={{ minHeight: '100vh', background: '#f0efe9' }} />;
  }

  return (
    <iframe
      title="Catalog — Business Plan"
      srcDoc={html}
      style={{ display: 'block', width: '100%', height: '100vh', border: 'none', background: '#f0efe9' }}
    />
  );
}
