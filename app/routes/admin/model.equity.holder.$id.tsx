// Admin → Model → Equity → one holder's page. Every participant on the
// cap table — SAFE investors, round investors, founders, advisory,
// pools — gets their own page: their terms (editable, same shared
// state as the Equity page), and their position at every stage: shares,
// ownership, dollar value, and the multiple on their money.

import { useMemo } from 'react';
import { Link, useNavigate, useParams } from '@remix-run/react';
import { fmtCurrency } from '~/services/projections';
import {
  computeEquity, roundSize,
  type EquityState, type PricedRound, type RoundInvestor, type SafeNote,
} from '~/services/equity';
import { useSharedEquity } from '~/hooks/useSharedEquity';
import AcctInput from '~/components/model/AcctInput';

const pct = (v: number, dp = 2) => `${(v * 100).toFixed(dp)}%`;
const shares = (n: number) => n.toLocaleString('en-US');

type Resolved =
  | { kind: 'holder'; name: string; type: string }
  | { kind: 'safe'; name: string; type: 'SAFE Investor'; safe: SafeNote }
  | { kind: 'round'; name: string; type: string; round: PricedRound; investor: RoundInvestor };

function resolve(equity: EquityState, id: string): Resolved | null {
  const holder = equity.holders.find(h => h.id === id);
  if (holder) {
    return { kind: 'holder', name: holder.name, type: holder.kind === 'founders' ? 'Founders' : holder.kind === 'advisory' ? 'Advisory' : 'Pool' };
  }
  const safe = equity.safes.find(s => s.id === id);
  if (safe) return { kind: 'safe', name: safe.name, type: 'SAFE Investor', safe };
  for (const round of equity.rounds) {
    const investor = round.investors.find(i => i.id === id);
    if (investor) return { kind: 'round', name: investor.name, type: round.name, round, investor };
  }
  return null;
}

export default function EquityHolderPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { equity, setEquity, live } = useSharedEquity();
  const summary = useMemo(() => computeEquity(equity), [equity]);
  const who = resolve(equity, id);

  const setSafe = (p: Partial<SafeNote>) =>
    setEquity(prev => ({ ...prev, safes: prev.safes.map(s => (s.id === id ? { ...s, ...p } : s)) }));
  const setHolder = (p: { name?: string; shares?: number }) =>
    setEquity(prev => ({ ...prev, holders: prev.holders.map(h => (h.id === id ? { ...h, ...p } : h)) }));
  const setInvestor = (roundId: string, p: Partial<RoundInvestor>) =>
    setEquity(prev => ({
      ...prev,
      rounds: prev.rounds.map(r => r.id === roundId
        ? { ...r, investors: r.investors.map(i => (i.id === id ? { ...i, ...p } : i)) }
        : r),
    }));

  if (!who) {
    return (
      <div className="admin-page model-page">
        <div className="admin-page-header"><h1>Not on the cap table</h1></div>
        <p className="eq-foot">This holder doesn&rsquo;t exist (anymore). <Link to="/admin/model/equity">Back to Equity</Link>.</p>
      </div>
    );
  }

  // Their row at every stage (round investors only appear from their round on).
  const journey = summary.stages
    .map(stage => ({ stage, row: stage.rows.find(r => r.id === id) }))
    .filter((e): e is { stage: typeof e.stage; row: NonNullable<typeof e.row> } => !!e.row);
  const ffRow = summary.foundationRows.find(r => r.id === id);
  const last = journey[journey.length - 1];
  const invested = who.kind === 'safe' ? who.safe.investment : who.kind === 'round' ? who.investor.investment : null;
  const multiple = invested && last && invested > 0 ? last.row.equityValue / invested : null;
  const conv = who.kind === 'safe' ? summary.safeConversions.find(c => c.safe.id === id) : null;

  return (
    <div className="admin-page model-page">
      <div className="admin-page-header">
        <h1>
          {who.name}
          <span className={`model-live${live ? ' is-live' : ''}`}>
            <span className="model-live-dot" />
            {live ? 'Live · shared' : 'Shared'}
          </span>
        </h1>
        <p className="admin-page-subtitle">
          {who.type} on the Catalog cap table. Edits here are the same shared numbers as the Equity page.
        </p>
      </div>

      <div className="eq-toprow">
        <Link className="eq-kaizen" to="/admin/model/equity">← Equity</Link>
      </div>

      {/* ── Their headline ── */}
      <div className="eq-band">
        <div className="eq-stat">
          <span className="eq-stat-label">{last ? `Value at ${last.stage.round.name}` : 'Shares'}</span>
          <b>{last ? fmtCurrency(last.row.equityValue, { compact: true }) : shares(ffRow?.shares ?? 0)}</b>
          <i>{last ? `${shares(last.row.shares)} shares · ${pct(last.row.pct)}` : 'before any priced round'}</i>
        </div>
        <div className="eq-stat">
          <span className="eq-stat-label">Invested</span>
          <b>{invested != null ? fmtCurrency(invested, { compact: true }) : '—'}</b>
          <i>{who.kind === 'safe' ? `SAFE · cap ${fmtCurrency(who.safe.valCap, { compact: true })}${who.safe.discount > 0 ? ` · ${Math.round(who.safe.discount * 100)}% discount` : ''}` : who.kind === 'round' ? `${who.type} check` : 'no cash — shares only'}</i>
        </div>
        <div className="eq-stat">
          <span className="eq-stat-label">Multiple on money</span>
          <b>{multiple != null ? `${multiple.toFixed(1)}×` : '—'}</b>
          <i>{multiple != null && last ? `paper, at ${last.stage.round.name} price` : 'n/a'}</i>
        </div>
        <div className="eq-stat">
          <span className="eq-stat-label">{conv ? 'Converts' : 'Type'}</span>
          <b>{conv ? `${shares(conv.shares)} sh` : who.type}</b>
          <i>{conv ? `${fmtCurrency(conv.price)} / share · on the ${conv.basis === 'discount' ? 'discount' : conv.basis === 'cap' ? 'cap' : 'sheet math'}` : ''}</i>
        </div>
      </div>

      {/* ── Their terms, editable ── */}
      <div className="eq-section admin-card">
        <div className="eq-section-head"><h3>Terms</h3></div>
        <div className="eq-round-vars">
          <label>
            <span>Name</span>
            <input
              className="eq-in eq-in-name"
              style={{ width: 240 }}
              value={who.name}
              onChange={e => {
                const name = e.target.value;
                if (who.kind === 'safe') setSafe({ name });
                else if (who.kind === 'holder') setHolder({ name });
                else setInvestor(who.round.id, { name });
              }}
            />
          </label>
          {who.kind === 'holder' && (
            <label>
              <span>Shares</span>
              <AcctInput className="eq-in" value={equity.holders.find(h => h.id === id)?.shares ?? 0} onChange={n => setHolder({ shares: n })} />
            </label>
          )}
          {who.kind === 'safe' && (
            <>
              <label><span>Investment</span><AcctInput className="eq-in" value={who.safe.investment} onChange={n => setSafe({ investment: n })} /></label>
              <label><span>Val cap</span><AcctInput className="eq-in" value={who.safe.valCap} onChange={n => setSafe({ valCap: n })} /></label>
              <label>
                <span>Discount</span>
                <span className="eq-pct">
                  <input className="eq-in" type="number" min={0} max={90} step={1}
                    value={Math.round(who.safe.discount * 100)}
                    onChange={e => setSafe({ discount: Math.max(0, Math.min(90, Number(e.target.value))) / 100 })} />
                  <em>%</em>
                </span>
              </label>
            </>
          )}
          {who.kind === 'round' && (
            <label><span>Investment ({who.type})</span><AcctInput className="eq-in" value={who.investor.investment} onChange={n => setInvestor(who.round.id, { investment: n })} /></label>
          )}
        </div>
      </div>

      {/* ── Their position at every stage ── */}
      <div className="eq-section admin-card">
        <div className="eq-section-head">
          <h3>Position by stage</h3>
          <span>dilution and value as each round closes</span>
        </div>
        <table className="eq-table">
          <thead>
            <tr><th>Stage</th><th className="num">$ / share</th><th className="num">Shares</th><th className="num">Ownership</th><th className="num">Value</th></tr>
          </thead>
          <tbody>
            {ffRow && (
              <tr>
                <td className="eq-type">Friends &amp; Family</td>
                <td className="num">—</td>
                <td className="num">{shares(ffRow.shares)}</td>
                <td className="num">{pct(ffRow.pct)}</td>
                <td className="num">—</td>
              </tr>
            )}
            {journey.map(({ stage, row }) => (
              <tr key={stage.round.id}>
                <td className="eq-type">
                  {stage.round.name}
                  <em style={{ fontStyle: 'normal', color: '#94a3b8', marginLeft: 8, fontWeight: 500 }}>
                    {fmtCurrency(roundSize(stage.round), { compact: true })} raised · post {fmtCurrency(stage.postMoney, { compact: true })}
                  </em>
                </td>
                <td className="num">{fmtCurrency(stage.pricePerShare)}</td>
                <td className="num">{shares(row.shares)}</td>
                <td className="num">{pct(row.pct)}</td>
                <td className="num">{fmtCurrency(row.equityValue, { compact: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {journey.length > 0 && (
          <div className="eq-bar" title="Ownership across stages (left → right: each round close)">
            {journey.map(({ stage, row }) => (
              <span
                key={stage.round.id}
                style={{ width: `${100 / journey.length}%`, background: '#4f46e5', opacity: 0.35 + 0.65 * (row.pct / Math.max(0.0001, journey[0].row.pct)) }}
                title={`${stage.round.name}: ${pct(row.pct)}`}
              />
            ))}
          </div>
        )}
      </div>

      <p className="eq-foot">
        Values are paper marks at each stage&rsquo;s price per share.
        <button type="button" className="eq-reset" onClick={() => navigate('/admin/model/equity')}>Back to the full cap table</button>
      </p>
    </div>
  );
}
