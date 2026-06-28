import { useState } from 'react';
import type { StyleUpTrace } from '~/services/style-up';

// Admin "view research" node diagram — a vertical flow of the steps that
// produced one stylist turn: the context fed in, the stylist persona, exactly
// what was sent to the model, the model's reply + queries, each web search's
// results, and the pieces that surfaced. Every node expands to its raw payload.

interface NodeProps {
  k: string;
  icon: string;
  title: string;
  summary: string;
  open: boolean;
  onToggle: (k: string) => void;
  children?: React.ReactNode;
}
function TraceNode({ k, icon, title, summary, open, onToggle, children }: NodeProps) {
  return (
    <div className="sut-node">
      <div className="sut-rail" aria-hidden="true"><span className="sut-dot" /></div>
      <div className="sut-card">
        <button type="button" className="sut-card-head" onClick={() => onToggle(k)}>
          <span className="sut-icon" aria-hidden="true">{icon}</span>
          <span className="sut-card-title">{title}</span>
          <span className="sut-card-summary">{summary}</span>
          {children ? <span className={`sut-chev${open ? ' is-open' : ''}`} aria-hidden="true">▾</span> : null}
        </button>
        {open && children ? <div className="sut-card-body">{children}</div> : null}
      </div>
    </div>
  );
}

export default function StyleUpTraceDiagram({ trace }: { trace: StyleUpTrace }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setOpen(o => ({ ...o, [k]: !o[k] }));

  const p = trace.payload || {};
  const ctx = (p.context as Record<string, unknown>) ?? {};
  const contextLine = String(p.context_line ?? '');
  const persona = String(p.persona ?? '');
  const system = String(p.system ?? '');
  const messages = (p.messages as Array<{ role: string; content: string }>) ?? [];
  const reply = String(p.reply ?? '');
  const queries = (p.search_queries as string[]) ?? [];
  const picks = (p.picks as Array<{ id?: string; name?: string; brand?: string }>) ?? [];
  const usage = (p.usage as { input_tokens?: number; output_tokens?: number }) ?? {};
  const model = String(p.model ?? '');
  const candidateCount = Number(p.candidate_count ?? 0);
  const isWeb = trace.sourceMode === 'web';
  const searches = trace.searches ?? [];
  const importedCount = searches.filter(s => s.importedId).length;

  return (
    <div className="sut">
      <TraceNode k="ctx" icon="👤" title="Context the stylist saw" summary={contextLine || 'none provided'} open={!!open.ctx} onToggle={toggle}>
        <dl className="sut-kv">
          {Object.entries(ctx).map(([key, val]) => (
            <div key={key} className="sut-kv-row"><dt>{key}</dt><dd>{val == null || val === '' ? '—' : String(val)}</dd></div>
          ))}
        </dl>
      </TraceNode>

      <TraceNode k="persona" icon="✦" title={`Stylist: ${String(p.stylist ?? '')}`} summary={`${isWeb ? 'web-sourced' : 'catalog'} · persona`} open={!!open.persona} onToggle={toggle}>
        <pre className="sut-pre">{persona || '—'}</pre>
      </TraceNode>

      <TraceNode k="sent" icon="→" title="Sent to the model" summary={`${model} · ${messages.length} msg${messages.length === 1 ? '' : 's'}${candidateCount ? ` · ${candidateCount} candidates` : ''}`} open={!!open.sent} onToggle={toggle}>
        <div className="sut-sub">System prompt</div>
        <pre className="sut-pre">{system || '—'}</pre>
        <div className="sut-sub">Conversation sent</div>
        {messages.map((m, i) => (
          <div key={i} className={`sut-turn sut-turn--${m.role}`}>
            <span className="sut-turn-role">{m.role}</span>
            <span className="sut-turn-text">{m.content}</span>
          </div>
        ))}
      </TraceNode>

      <TraceNode k="ai" icon="💬" title="Model response" summary={reply ? reply.slice(0, 70) : '—'} open={!!open.ai} onToggle={toggle}>
        <div className="sut-sub">Reply</div>
        <pre className="sut-pre">{reply || '—'}</pre>
        {isWeb ? (
          <>
            <div className="sut-sub">Search queries it generated ({queries.length})</div>
            {queries.length ? queries.map((q, i) => <div key={i} className="sut-chip">{q}</div>) : <div className="sut-muted">none this turn</div>}
          </>
        ) : (
          <>
            <div className="sut-sub">Catalog picks ({picks.length})</div>
            {picks.length ? picks.map((pk, i) => <div key={i} className="sut-chip">{[pk.brand, pk.name].filter(Boolean).join(' · ') || pk.id}</div>) : <div className="sut-muted">none this turn</div>}
          </>
        )}
        {(usage.input_tokens || usage.output_tokens) ? (
          <div className="sut-muted">tokens: {usage.input_tokens ?? '?'} in · {usage.output_tokens ?? '?'} out</div>
        ) : null}
      </TraceNode>

      {isWeb && (
        <TraceNode k="search" icon="🔎" title="Searches run" summary={searches.length ? `${searches.length} queries · ${importedCount} imported` : 'not recorded'} open={!!open.search} onToggle={toggle}>
          {searches.length ? searches.map((s, i) => (
            <div key={i} className="sut-search">
              <div className="sut-search-q">{s.query}</div>
              <div className={`sut-search-stat${s.ok ? '' : ' is-err'}`}>
                {s.ok
                  ? `${s.rawCount} found · ${s.withUrl} w/url · ${s.matched} usable`
                  : `ERROR: ${s.error}`}
              </div>
              <div className="sut-search-imp">{s.importedId ? `→ imported: ${s.importedName || s.importedId}` : '→ nothing usable imported'}</div>
            </div>
          )) : <div className="sut-muted">No search results recorded (older turn, or catalog stylist).</div>}
        </TraceNode>
      )}

      <TraceNode k="out" icon="🛍️" title="Surfaced to the shopper" summary={isWeb ? `${importedCount} piece${importedCount === 1 ? '' : 's'}` : `${picks.length} piece${picks.length === 1 ? '' : 's'}`} open={!!open.out} onToggle={toggle}>
        {isWeb
          ? (importedCount
              ? searches.filter(s => s.importedId).map((s, i) => <div key={i} className="sut-chip">{s.importedName || s.importedId}</div>)
              : <div className="sut-muted">nothing surfaced</div>)
          : (picks.length
              ? picks.map((pk, i) => <div key={i} className="sut-chip">{[pk.brand, pk.name].filter(Boolean).join(' · ') || pk.id}</div>)
              : <div className="sut-muted">nothing surfaced</div>)}
      </TraceNode>
    </div>
  );
}
