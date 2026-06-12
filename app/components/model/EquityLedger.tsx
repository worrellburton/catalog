// The Ledger view — the cap table as the stock ledger reads: one line
// per check, chronological, investor-first. Rounds still do the pricing
// underneath (a SAFE's terms are its cap/discount; a priced check's
// terms are its round's $/share) — this view just stops organising the
// money by event and lists it the way it actually arrived.

import { useState } from 'react';
import { Link } from '@remix-run/react';
import { fmtCurrency } from '~/services/projections';
import {
  type EquityState, type EquitySummary, type PricedRound, type RoundInvestor, type SafeNote,
} from '~/services/equity';
import AcctInput from '~/components/model/AcctInput';

const pct = (v: number, dp = 2) => `${(v * 100).toFixed(dp)}%`;
const shares = (n: number) => n.toLocaleString('en-US');

interface LedgerLine {
  id: string;
  date: string;            // '' sorts to its structural order
  name: string;
  kind: 'safe' | 'round';
  type: string;            // 'SAFE' or the round's name
  invested: number;
  /** $/share this check converts/buys at (SAFE conversion or round price). */
  price: number | null;
  safe?: SafeNote;
  round?: PricedRound;
  investor?: RoundInvestor;
  /** Round entries carry their round's post-money as the entry valuation. */
  roundPost?: number;
  order: number;           // structural fallback order (SAFEs, then rounds)
}

export default function EquityLedger({ equity, summary, onSafe, onInvestor, onAddSafe }: {
  equity: EquityState;
  summary: EquitySummary;
  onSafe: (id: string, p: Partial<SafeNote>) => void;
  onInvestor: (roundId: string, invId: string, p: Partial<RoundInvestor>) => void;
  onAddSafe: () => void;
}) {
  // The MARK: which stage the ownership/value columns are priced at.
  // "Now" was a lie — before any round closes, nothing is worth the
  // Series B mark. So the reader picks the stage and the columns say so.
  const lastStage = summary.stages[summary.stages.length - 1];
  const [markId, setMarkId] = useState<string>(() => {
    try { return window.localStorage.getItem('catalog:equity:ledger-mark') ?? (lastStage?.round.id ?? 'ff'); }
    catch { return lastStage?.round.id ?? 'ff'; }
  });
  const markStage = summary.stages.find(s => s.round.id === markId) ?? lastStage ?? null;
  const markIsFF = markId === 'ff' || !markStage;
  const markLabel = markIsFF ? 'F&F (unpriced)' : markStage!.round.name;
  const pickMark = (v: string) => {
    setMarkId(v);
    try { window.localStorage.setItem('catalog:equity:ledger-mark', v); } catch { /* quota */ }
  };
  const rowNow = (id: string) => markIsFF
    ? summary.foundationRows.find(r => r.id === id)
    : markStage!.rows.find(r => r.id === id) ?? summary.foundationRows.find(r => r.id === id);

  let order = 0;
  const lines: LedgerLine[] = [
    ...equity.safes.map(s => {
      const conv = summary.safeConversions.find(c => c.safe.id === s.id);
      return {
        id: s.id, date: s.date ?? '', name: s.name, kind: 'safe' as const, type: 'SAFE',
        invested: s.investment, price: conv && conv.price > 0 ? conv.price : null,
        safe: s, order: order++,
      };
    }),
    ...equity.rounds.flatMap(r => {
      const stage = summary.stages.find(st => st.round.id === r.id);
      return r.investors.map(i => ({
        id: i.id, date: i.date ?? '', name: i.name, kind: 'round' as const, type: r.name,
        invested: i.investment, price: stage ? stage.pricePerShare : null,
        round: r, investor: i, roundPost: stage?.postMoney, order: order++,
      }));
    }),
  ].sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date) || a.order - b.order;
    if (a.date !== '' || b.date !== '') return a.date ? -1 : 1;
    return a.order - b.order;
  });

  const totalIn = lines.reduce((a, l) => a + l.invested, 0);

  return (
    <div className="eq-section admin-card">
      <div className="eq-section-head">
        <h3>Ledger</h3>
        <span>
          every check, in the order it landed · {fmtCurrency(totalIn, { compact: true })} across {lines.length} entries
        </span>
        <label className="eq-mark">
          <em>Marked at</em>
          <select value={markIsFF ? 'ff' : markStage!.round.id} onChange={e => pickMark(e.target.value)}>
            <option value="ff">Friends &amp; Family (unpriced)</option>
            {summary.stages.map(s => (
              <option key={s.round.id} value={s.round.id}>
                {s.round.name} close · {fmtCurrency(s.postMoney, { compact: true })} post
              </option>
            ))}
          </select>
        </label>
      </div>
      <table className="eq-table">
        <thead>
          <tr>
            <th>Date</th><th>Type</th><th>Investor</th><th className="num">Check</th>
            <th className="num">Valuation in at</th><th className="num">Discount</th><th className="num">$ / share</th>
            <th className="num">Shares</th><th className="num">Own. at {markLabel}</th><th className="num">Value at {markLabel}</th><th className="num">Multiple</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(l => {
            const now = rowNow(l.id);
            const value = now?.equityValue ?? 0;
            const multiple = l.invested > 0 && value > 0 ? value / l.invested : null;
            const setDate = (date: string) =>
              l.kind === 'safe' ? onSafe(l.id, { date }) : onInvestor(l.round!.id, l.id, { date });
            return (
              <tr key={l.id}>
                <td data-l="Date">
                  <input
                    className="eq-in eq-in-date"
                    type="date"
                    value={l.date}
                    onChange={e => setDate(e.target.value)}
                  />
                </td>
                <td className="eq-type" data-l="Type">{l.type}</td>
                <td className="eq-namecell" data-l="Investor">
                  <input
                    className="eq-in eq-in-name"
                    value={l.name}
                    onChange={e => l.kind === 'safe' ? onSafe(l.id, { name: e.target.value }) : onInvestor(l.round!.id, l.id, { name: e.target.value })}
                  />
                  <Link className="eq-open" to={`/admin/model/equity/holder/${l.id}`} title="Open this investor's page">↗</Link>
                </td>
                <td className="num" data-l="Check">
                  <AcctInput
                    className="eq-in"
                    value={l.invested}
                    onChange={n => l.kind === 'safe' ? onSafe(l.id, { investment: n }) : onInvestor(l.round!.id, l.id, { investment: n })}
                  />
                </td>
                {/* Self-contained terms: a SAFE's entry valuation is its cap
                    (editable); a priced check's is its round's post-money. */}
                <td className="num" data-l="Valuation in at">
                  {l.kind === 'safe'
                    ? <AcctInput className="eq-in" value={l.safe!.valCap} onChange={n => onSafe(l.id, { valCap: n })} />
                    : l.roundPost != null ? `${fmtCurrency(l.roundPost, { compact: true })} post` : '—'}
                </td>
                <td className="num" data-l="Discount">
                  {l.kind === 'safe' ? (
                    <span className="eq-pct">
                      <input className="eq-in" type="number" min={0} max={90} step={1}
                        value={Math.round(l.safe!.discount * 100)}
                        onChange={e => onSafe(l.id, { discount: Math.max(0, Math.min(90, Number(e.target.value))) / 100 })} />
                      <em>%</em>
                    </span>
                  ) : '—'}
                </td>
                <td className="num" data-l="$ / share">{l.price != null ? fmtCurrency(l.price) : '—'}</td>
                <td className="num" data-l="Shares">{shares(now?.shares ?? 0)}</td>
                <td className="num" data-l={`Own. at ${markLabel}`}>{pct(now?.pct ?? 0)}</td>
                <td className="num" data-l={`Value at ${markLabel}`}>{markIsFF ? '—' : fmtCurrency(value, { compact: true })}</td>
                <td className="num eq-computed" data-l="Multiple">{markIsFF || multiple == null ? '—' : `${multiple.toFixed(1)}×`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="eq-adders">
        <button type="button" onClick={onAddSafe}>+ Check (SAFE)</button>
      </div>
      <p className="eq-foot" style={{ marginBottom: 0 }}>
        Ownership and value are PROJECTED at the marked stage&rsquo;s price — nothing is worth that
        until the round actually closes. New money between priced rounds is a SAFE — that&rsquo;s what
        &ldquo;getting in at a certain time&rdquo; is, legally; manage rounds in the Rounds view.
      </p>
    </div>
  );
}
