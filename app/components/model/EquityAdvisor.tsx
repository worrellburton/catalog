// The Equity page's financial advisor — a Claude chat that sees the
// live cap table, the computed stages and the model assumptions.
// Replaces the generic AI-generation FAB on this screen. Answers carry
// an optional PROPOSAL (a complete updated equity state) with a
// one-tap Apply.

import { useEffect, useRef, useState } from 'react';
import { askEquityAdvisor, KAIZEN_PROMPT, type AdvisorTurn } from '~/services/equity-advisor';
import type { EquityState } from '~/services/equity';

interface Msg extends AdvisorTurn {
  proposal?: EquityState | null;
  applied?: boolean;
  error?: boolean;
}

export default function EquityAdvisor({ equity, onApply, kaizenSignal }: {
  equity: EquityState;
  onApply: (next: EquityState) => void;
  /** Increment to open the panel and fire the canned Kaizen audit. */
  kaizenSignal: number;
}) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const equityRef = useRef(equity);
  equityRef.current = equity;

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy, open]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    setInput('');
    setBusy(true);
    setMsgs(prev => [...prev, { role: 'user', content }]);
    try {
      const history: AdvisorTurn[] = [...msgs, { role: 'user' as const, content }]
        .filter((m: Msg) => !m.error)
        .map(m => ({ role: m.role, content: m.content }));
      const answer = await askEquityAdvisor(history, equityRef.current);
      setMsgs(prev => [...prev, { role: 'assistant', content: answer.reply, proposal: answer.proposal }]);
    } catch (err) {
      setMsgs(prev => [...prev, {
        role: 'assistant',
        content: `Couldn't reach the advisor — ${err instanceof Error ? err.message : 'unknown error'}. Try again.`,
        error: true,
      }]);
    } finally {
      setBusy(false);
    }
  };

  // The page's 改 Kaizen button: open + fire the canned audit.
  const kaizenRan = useRef(0);
  useEffect(() => {
    if (!kaizenSignal || kaizenSignal === kaizenRan.current) return;
    kaizenRan.current = kaizenSignal;
    setOpen(true);
    void send(KAIZEN_PROMPT);
    // send reads live refs/state; the signal is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kaizenSignal]);

  const apply = (i: number, proposal: EquityState) => {
    onApply(proposal);
    setMsgs(prev => prev.map((m, idx) => (idx === i ? { ...m, applied: true } : m)));
  };

  return (
    <>
      <button
        type="button"
        className={`eqa-fab${open ? ' is-open' : ''}`}
        title="Talk to the fundraise advisor — it sees this whole cap table and the model"
        onClick={() => setOpen(o => !o)}
      >
        <svg viewBox="0 0 100 100" width="20" height="20" aria-hidden="true">
          <path d="M50 4 C54 30 70 46 96 50 C70 54 54 70 50 96 C46 70 30 54 4 50 C30 46 46 30 50 4 Z" fill="currentColor" />
        </svg>
        <span>Advisor</span>
      </button>

      {open && (
        <div className="eqa-panel" role="dialog" aria-label="Fundraise advisor">
          <div className="eqa-head">
            <b>Fundraise advisor</b>
            <span>sees this cap table, every round, and the model</span>
            <button type="button" className="eq-x" aria-label="Close" onClick={() => setOpen(false)}>×</button>
          </div>
          <div className="eqa-log" ref={logRef}>
            {msgs.length === 0 && !busy && (
              <div className="eqa-hint">
                Ask anything — &ldquo;is my seed priced right?&rdquo;, &ldquo;what does a 15% pool at
                Series A cost me?&rdquo;, &ldquo;how much should we raise to reach the Series A
                milestones?&rdquo; — or hit 改 Kaizen for a full audit. When the advice implies a
                concrete restructure you&rsquo;ll get an Apply button.
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`eqa-msg eqa-msg-${m.role}${m.error ? ' is-error' : ''}`}>
                <p>{m.content}</p>
                {m.proposal && (
                  <button
                    type="button"
                    className="eqa-apply"
                    disabled={m.applied}
                    onClick={() => apply(i, m.proposal!)}
                  >
                    {m.applied ? '✓ Applied to the cap table' : 'Apply this to the cap table'}
                  </button>
                )}
              </div>
            ))}
            {busy && <div className="eqa-msg eqa-msg-assistant eqa-busy"><span /><span /><span /></div>}
          </div>
          <div className="eqa-input">
            <input
              value={input}
              placeholder="Ask the advisor…"
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void send(input); }}
            />
            <button type="button" disabled={busy || !input.trim()} onClick={() => void send(input)}>↑</button>
          </div>
        </div>
      )}
    </>
  );
}
