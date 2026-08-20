// Admin · one StyleUp conversation, on its own page.
//
// Was a slide-over drawer on /admin/style; a conversation is the thing an
// admin actually reads (long transcripts, research traces, generated looks),
// so it gets a real URL — shareable, refreshable, back-button-able. Two views
// via ?view=: the transcript (default) and the research trace for each stylist
// turn. Still READ-ONLY — no replying, no deleting.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from '@remix-run/react';
import {
  adminGetThread, adminListTraces, adminRenderVideos, buildProvenanceIndex, fetchMessages,
  type AdminThread, type RetrievalCandidate, type StyleUpMessage, type StyleUpRetrieval, type StyleUpTrace,
} from '~/services/style-up';
import StyleUpTraceDiagram, { TIER_TITLE } from '~/components/style-up/StyleUpTraceDiagram';
import { fmtTime, statusClass } from '~/components/style-up/admin-format';
import '~/styles/admin-style-up.css';

type ThreadHead = Pick<AdminThread, 'threadId' | 'shopper' | 'stylist' | 'lastMessageAt'>;

/** A render message, with the actual look inline instead of just its id. */
function RenderBubble({ gen, genId }: { gen: { status: string; videoUrl: string | null } | undefined; genId: string | null }) {
  const status = gen?.status ?? 'pending';
  return (
    <div className="suc-render">
      {gen?.videoUrl
        ? <video src={gen.videoUrl} muted loop playsInline controls className="suc-render-video" />
        : <div className="suc-render-video suc-render-video--empty">{status === 'failed' ? 'failed' : 'rendering…'}</div>}
      <div className="suc-render-foot">
        <span>On-you look</span>
        <span className={statusClass(status)}>{status}</span>
      </div>
      {genId && <Link className="suc-render-audit" to={`/admin/style/g/${genId}`}>audit →</Link>}
    </div>
  );
}

/** A product message, with a "why this?" toggle onto its recorded retrieval
 *  provenance — slot, rank within that slot, score, the literal query, and
 *  the fallback tier. `hit` is undefined for anything the provenance index
 *  couldn't join: a turn that predates capture, or a piece that wasn't
 *  pulled from the catalog at all (e.g. a web-sourced pick). */
function ProductBubble({ m, hit }: {
  m: StyleUpMessage;
  hit: { retrieval: StyleUpRetrieval; candidate: RetrievalCandidate } | undefined;
}) {
  const [open, setOpen] = useState(false);
  const slot = hit?.candidate.slot
    ? (hit.retrieval.slots ?? []).find(s => s.slot === hit.candidate.slot)
    : undefined;
  return (
    <div className="suc-product">
      <div className="sua-msg-product">
        {m.productRef?.image && <img src={m.productRef.image} alt="" />}
        <span>{[m.productRef?.brand, m.productRef?.name].filter(Boolean).join(' · ') || 'Product'}</span>
      </div>
      <button type="button" className="suc-why-btn" onClick={() => setOpen(o => !o)}>
        {open ? 'hide' : 'why this?'}
      </button>
      {open && (
        <div className="suc-why">
          {!hit ? (
            <span className="sut-muted">
              Not recorded — this turn predates provenance capture, or the piece was
              not pulled from the catalog.
            </span>
          ) : (
            <dl className="sut-kv">
              <div className="sut-kv-row"><dt>slot</dt><dd>{hit.candidate.slot ?? 'recency scan'}</dd></div>
              <div className="sut-kv-row"><dt>rank</dt>
                <dd>{hit.candidate.rank == null ? '—'
                  : hit.candidate.slot == null ? `${hit.candidate.rank + 1} (recency scan)`
                  : `${hit.candidate.rank + 1} of ${slot?.kept ?? '?'} in ${hit.candidate.slot}`}</dd></div>
              <div className="sut-kv-row"><dt>score</dt>
                <dd>{hit.candidate.score == null ? 'n/a (recency scan)' : hit.candidate.score.toFixed(3)}</dd></div>
              <div className="sut-kv-row"><dt>query</dt><dd>{slot?.query ?? '—'}</dd></div>
              <div className="sut-kv-row"><dt>tier</dt>
                <dd>{slot ? `${slot.tier} — ${TIER_TITLE[slot.tier]}` : '—'}</dd></div>
              <div className="sut-kv-row"><dt>occasion</dt><dd>{hit.retrieval.occasion || '(empty)'}</dd></div>
            </dl>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminStyleConversation() {
  const { threadId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') === 'research' ? 'research' : 'transcript';
  const setView = useCallback((v: string) => {
    setSearchParams(v === 'transcript' ? {} : { view: v }, { replace: true });
  }, [setSearchParams]);

  const [head, setHead] = useState<ThreadHead | null>(null);
  const [transcript, setTranscript] = useState<StyleUpMessage[]>([]);
  const [renders, setRenders] = useState<Map<string, { status: string; videoUrl: string | null }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  const [traces, setTraces] = useState<StyleUpTrace[]>([]);
  const [traceIdx, setTraceIdx] = useState(0);
  const [traceLoading, setTraceLoading] = useState(false);

  // Header is fetched once — the shopper and stylist can't change mid-thread.
  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    void (async () => {
      const t = await adminGetThread(threadId);
      if (cancelled) return;
      setHead(t);
      setMissing(!t);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [threadId]);

  // Live transcript — same 4s cadence the drawer used, plus the videos for
  // whichever renders the thread has produced so far.
  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    const tick = async () => {
      const msgs = await fetchMessages(threadId);
      if (cancelled) return;
      setTranscript(msgs);
      const genIds = msgs.map(m => m.renderGenerationId).filter((x): x is string => !!x);
      if (genIds.length) {
        const vids = await adminRenderVideos(genIds);
        if (!cancelled) setRenders(vids);
      }
    };
    void tick();
    const h = window.setInterval(tick, 4000);
    return () => { cancelled = true; window.clearInterval(h); };
  }, [threadId]);

  // Traces load on mount (not gated on the research tab) — the transcript's
  // product bubbles need them too, for the "why this?" provenance lookup.
  useEffect(() => {
    if (!threadId || traces.length > 0) return;
    let cancelled = false;
    setTraceLoading(true);
    void (async () => {
      const t = await adminListTraces(threadId);
      if (cancelled) return;
      setTraces(t);
      setTraceIdx(0);
      setTraceLoading(false);
    })();
    return () => { cancelled = true; };
  }, [threadId, traces.length]);

  const awaiting = transcript.length > 0 && transcript[transcript.length - 1].sender === 'shopper';
  const stylistColor = head?.stylist.accentColor ?? '#8aa0c0';
  const lookCount = useMemo(() => transcript.filter(m => m.kind === 'render').length, [transcript]);
  const provenance = useMemo(() => buildProvenanceIndex(traces), [traces]);

  if (loading) return <div className="sua"><div className="sua-empty">Loading conversation…</div></div>;
  if (missing) {
    return (
      <div className="sua">
        <Link to="/admin/style" className="suc-back">← Style</Link>
        <div className="sua-empty">That conversation no longer exists.</div>
      </div>
    );
  }

  return (
    <div className="sua">
      <Link to="/admin/style" className="suc-back">← Style</Link>

      <div className="suc-head">
        <span className="sua-avatar" aria-hidden="true">
          {head?.shopper.avatarUrl ? <img src={head.shopper.avatarUrl} alt="" /> : (head?.shopper.name[0] || '?')}
        </span>
        <div className="suc-head-id">
          <h1 className="sua-title">{head?.shopper.name}</h1>
          <p className="sua-sub">
            with <b style={{ color: stylistColor }}>{head?.stylist.name}</b>
            {head?.stylist.sourceMode === 'web' && ' · web'}
            {' · '}{transcript.length} message{transcript.length === 1 ? '' : 's'}
            {lookCount > 0 && ` · ${lookCount} look${lookCount === 1 ? '' : 's'}`}
            {head?.lastMessageAt && ` · last active ${fmtTime(head.lastMessageAt)}`}
          </p>
        </div>
        {awaiting && <span className="sua-badge">Awaiting reply</span>}
      </div>

      <div className="sua-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={view === 'transcript'}
          className={`sua-tab${view === 'transcript' ? ' is-active' : ''}`} onClick={() => setView('transcript')}>
          Transcript <span className="sua-count">{transcript.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={view === 'research'}
          className={`sua-tab${view === 'research' ? ' is-active' : ''}`} onClick={() => setView('research')}>
          Research{traces.length > 0 && <span className="sua-count">{traces.length}</span>}
        </button>
      </div>

      {view === 'transcript' && (
        <div className="suc-transcript">
          {transcript.length === 0 && <div className="sua-empty">No messages.</div>}
          {transcript.map(m => {
            if (m.kind === 'render') {
              return (
                <div key={m.id} className="sua-msg sua-msg--stylist">
                  <RenderBubble gen={m.renderGenerationId ? renders.get(m.renderGenerationId) : undefined} genId={m.renderGenerationId ?? null} />
                </div>
              );
            }
            if (m.kind === 'product' && m.productRef) {
              return (
                <div key={m.id} className="sua-msg sua-msg--stylist">
                  <ProductBubble m={m} hit={m.productRef.id ? provenance.get(m.productRef.id) : undefined} />
                </div>
              );
            }
            return (
              <div key={m.id} className={`sua-msg sua-msg--${m.sender}`}>
                <div className="suc-msg-col">
                  <div className="sua-bubble">{m.body}</div>
                  <span className="suc-msg-time">{fmtTime(m.createdAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === 'research' && (
        <div className="suc-research">
          {traces.length > 1 && (
            <div className="sua-trace-turns">
              {traces.map((tr, i) => (
                <button key={tr.id} type="button" className={`sua-trace-turn${i === traceIdx ? ' is-active' : ''}`} onClick={() => setTraceIdx(i)}>
                  {fmtTime(tr.createdAt)}{tr.sourceMode === 'web' ? ' · web' : ''}
                </button>
              ))}
            </div>
          )}
          <div className="sua-trace-body">
            {traceLoading && <div className="sua-empty">Loading…</div>}
            {!traceLoading && traces.length === 0 && (
              <div className="sua-empty">No research traces for this conversation yet. Traces are recorded on new stylist turns.</div>
            )}
            {!traceLoading && traces[traceIdx] && <StyleUpTraceDiagram trace={traces[traceIdx]} />}
          </div>
        </div>
      )}
    </div>
  );
}
