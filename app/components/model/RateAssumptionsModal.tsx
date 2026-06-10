import { useEffect, useState, type ReactElement } from 'react';
import { supabase } from '~/utils/supabase';

interface ProviderResult { text?: string; error?: string; model?: string }
interface RateResult { claude: ProviderResult; gemini: ProviderResult; system?: string; prompt?: string }

const PRE_STYLE: React.CSSProperties = {
  whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#f7f7f8',
  border: '1px solid #eee', borderRadius: 8, padding: 10, fontSize: 11.5,
  lineHeight: 1.5, maxHeight: 240, overflow: 'auto', margin: 0,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#333',
};
const PROMPT_LABEL: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase',
  letterSpacing: '0.4px', margin: '10px 0 3px',
};

// Light markdown-ish renderer: bullets, bold headers, paragraphs.
function Rendered({ text }: { text: string }) {
  const lines = text.split('\n');
  const out: ReactElement[] = [];
  let bullets: string[] = [];
  const flush = (key: string) => {
    if (bullets.length) {
      out.push(<ul key={`ul-${key}`} className="rate-ul">{bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>);
      bullets = [];
    }
  };
  const inline = (s: string) => {
    // bold **x**
    const parts = s.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, i) => p.startsWith('**') && p.endsWith('**')
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>);
  };
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) { flush(String(idx)); return; }
    if (/^[-*•]\s+/.test(line)) { bullets.push(line.replace(/^[-*•]\s+/, '')); return; }
    flush(String(idx));
    if (/^#{1,4}\s+/.test(line)) { out.push(<h5 key={idx} className="rate-h">{inline(line.replace(/^#{1,4}\s+/, ''))}</h5>); return; }
    if (/^\*\*.+\*\*:?$/.test(line)) { out.push(<h5 key={idx} className="rate-h">{inline(line)}</h5>); return; }
    out.push(<p key={idx} className="rate-p">{inline(line)}</p>);
  });
  flush('end');
  return <>{out}</>;
}

function Panel({ title, accent, result, loading }: { title: string; accent: string; result?: ProviderResult; loading: boolean }) {
  return (
    <div className="rate-panel">
      <div className="rate-panel-head">
        <span className="rate-panel-dot" style={{ background: accent }} />
        <span className="rate-panel-title">{title}</span>
        {result?.model && <span className="rate-panel-model">{result.model}</span>}
      </div>
      <div className="rate-panel-body">
        {loading && <div className="rate-loading"><span className="rate-spinner" /> Analyzing your model…</div>}
        {!loading && result?.error && <div className="rate-error">{result.error}</div>}
        {!loading && result?.text && <Rendered text={result.text} />}
      </div>
    </div>
  );
}

export default function RateAssumptionsModal({ open, onClose, payload }: { open: boolean; onClose: () => void; payload: unknown }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RateResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    if (!supabase) { setErr('Supabase not configured.'); return; }
    setLoading(true); setErr(null); setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('rate-assumptions', { body: { model: payload } });
      if (error) throw error;
      setResult(data as RateResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to reach the analysts.');
    } finally {
      setLoading(false);
    }
  };

  // Run once when the modal opens.
  useEffect(() => {
    if (open) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="rate-overlay" role="dialog" aria-modal="true" aria-label="Rate my assumptions" onClick={onClose}>
      <div className="rate-modal" onClick={e => e.stopPropagation()}>
        <div className="rate-modal-head">
          <div>
            <h2 className="rate-modal-title">Rate my assumptions</h2>
            <p className="rate-modal-sub">Two AI analysts pressure-test your model and tell you what to change.</p>
          </div>
          <div className="rate-modal-actions">
            <button className="admin-btn admin-btn-secondary" onClick={run} disabled={loading}>{loading ? 'Running…' : 'Re-run'}</button>
            <button className="rate-close" onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>
        {err && <div className="rate-error rate-error--top">{err}</div>}
        <div className="rate-panels">
          <Panel title="Claude (Opus 4.8)" accent="#d97757" result={result?.claude} loading={loading} />
          <Panel title="Gemini" accent="#4285f4" result={result?.gemini} loading={loading} />
        </div>
        {(result?.system || result?.prompt) && (
          <details style={{ margin: '4px 4px 0', borderTop: '1px solid #eee', paddingTop: 8 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#555' }}>
              What goes into both models — the exact prompt
            </summary>
            <div style={{ marginTop: 6 }}>
              <p style={{ fontSize: 11.5, color: '#777', margin: '0 0 4px' }}>
                Claude and Gemini both receive this identical system prompt + your model as the user message.
              </p>
              {result?.system && (<><div style={PROMPT_LABEL}>System prompt</div><pre style={PRE_STYLE}>{result.system}</pre></>)}
              {result?.prompt && (<><div style={PROMPT_LABEL}>User message (your model)</div><pre style={PRE_STYLE}>{result.prompt}</pre></>)}
            </div>
          </details>
        )}
        <p className="rate-disclaimer">AI feedback — directional, not financial advice. Verify against your own benchmarks.</p>
      </div>
    </div>
  );
}
