// Admin → Model → Equity. The cap table, projected forward: foundation
// (founders + SAFEs + early options), then each priced round stacked on
// top — price per share, conversion, dilution, ownership at every
// stage. Every number is editable; rows and rounds add/remove. Two SAFE
// math modes: YC post-money (the standard) and Sheet (reproduces the
// founder's spreadsheet exactly). Shared live across admins.

import { useMemo } from 'react';
import { fmtCurrency } from '~/services/projections';
import {
  computeEquity, equityUid, EQUITY_DEFAULTS,
  type CapHolder, type EquityState, type PricedRound, type SafeNote,
} from '~/services/equity';
import { useSharedEquity } from '~/hooks/useSharedEquity';
import ModelTabs from '~/components/model/ModelTabs';
import AcctInput from '~/components/model/AcctInput';

const pct = (v: number, dp = 2) => `${(v * 100).toFixed(dp)}%`;
const shares = (n: number) => n.toLocaleString('en-US');

export default function EquityPage() {
  const { equity, setEquity, live } = useSharedEquity();
  const summary = useMemo(() => computeEquity(equity), [equity]);
  const lastStage = summary.stages[summary.stages.length - 1];

  const patch = (p: Partial<EquityState>) => setEquity(prev => ({ ...prev, ...p }));
  const setHolder = (id: string, p: Partial<CapHolder>) =>
    patch({ holders: equity.holders.map(h => (h.id === id ? { ...h, ...p } : h)) });
  const setSafe = (id: string, p: Partial<SafeNote>) =>
    patch({ safes: equity.safes.map(s => (s.id === id ? { ...s, ...p } : s)) });
  const setRound = (id: string, p: Partial<PricedRound>) =>
    patch({ rounds: equity.rounds.map(r => (r.id === id ? { ...r, ...p } : r)) });

  const addRoundName = () => {
    const letters = ['Seed', 'Series A', 'Series B', 'Series C', 'Series D', 'Series E'];
    return letters[Math.min(equity.rounds.length, letters.length - 1)];
  };

  return (
    <div className="admin-page model-page">
      <div className="admin-page-header">
        <h1>
          Equity
          <span className={`model-live${live ? ' is-live' : ''}`} title={live ? 'Saved for everyone — edits sync live across admins' : 'Shared model — connecting…'}>
            <span className="model-live-dot" />
            {live ? 'Live · shared' : 'Shared'}
          </span>
        </h1>
        <p className="admin-page-subtitle">
          The cap table projected forward: foundation SAFEs convert at the first priced round, then
          every round stacks — price per share, shares, ownership and dollar value at each stage.
          Edit anything; dilution cascades.
        </p>
      </div>

      <ModelTabs active="equity" />

      {/* ── Headline ── */}
      <div className="eq-band">
        <div className="eq-stat">
          <span className="eq-stat-label">Founders at {lastStage?.round.name ?? 'today'}</span>
          <b>{pct(lastStage ? (lastStage.rows.find(r => r.group === 'founders')?.pct ?? 0) : 1)}</b>
          <i>worth {fmtCurrency(lastStage?.rows.find(r => r.group === 'founders')?.equityValue ?? 0, { compact: true })}</i>
        </div>
        <div className="eq-stat">
          <span className="eq-stat-label">Total new money</span>
          <b>{fmtCurrency(equity.safes.reduce((a, s) => a + s.investment, 0) + equity.rounds.reduce((a, r) => a + r.investment, 0), { compact: true })}</b>
          <i>SAFEs + {equity.rounds.length} priced rounds</i>
        </div>
        <div className="eq-stat">
          <span className="eq-stat-label">{lastStage?.round.name ?? '—'} post-money</span>
          <b>{fmtCurrency(lastStage?.postMoney ?? 0, { compact: true })}</b>
          <i>{shares(lastStage?.sharesAfter ?? summary.foundationCap)} shares · {fmtCurrency(lastStage?.pricePerShare ?? 0)} / share</i>
        </div>
        <div className="eq-stat">
          <span className="eq-stat-label">SAFE math</span>
          <div className="eq-mode">
            <button type="button" className={equity.safeMode === 'postMoney' ? 'is-active' : ''} onClick={() => patch({ safeMode: 'postMoney' })}>YC post-money</button>
            <button type="button" className={equity.safeMode === 'sheet' ? 'is-active' : ''} onClick={() => patch({ safeMode: 'sheet' })}>Sheet</button>
          </div>
          <i>{equity.safeMode === 'postMoney' ? 'caps lock ownership; converts at the first round' : 'cap ÷ founder shares — matches the spreadsheet'}</i>
        </div>
      </div>

      {/* ── Foundation ── */}
      <div className="eq-section admin-card">
        <div className="eq-section-head">
          <h3>Foundation</h3>
          <span>{shares(summary.foundersShares)} founder shares · {shares(summary.safeShares)} SAFE shares · capitalization {shares(summary.foundationCap)}</span>
        </div>

        <table className="eq-table">
          <thead>
            <tr><th>Type</th><th>Holder</th><th className="num">Investment</th><th className="num">Val cap</th><th className="num">Discount</th><th className="num">Shares</th><th /></tr>
          </thead>
          <tbody>
            {equity.holders.map(h => (
              <tr key={h.id}>
                <td className="eq-type">{h.kind === 'founders' ? 'Founders' : h.kind === 'advisory' ? 'Advisory' : 'Pool'}</td>
                <td><input className="eq-in eq-in-name" value={h.name} onChange={e => setHolder(h.id, { name: e.target.value })} /></td>
                <td className="num eq-na">—</td>
                <td className="num eq-na">—</td>
                <td className="num eq-na">—</td>
                <td className="num"><AcctInput className="eq-in" value={h.shares} onChange={n => setHolder(h.id, { shares: n })} /></td>
                <td>
                  {h.kind !== 'founders' && (
                    <button type="button" className="eq-x" title="Remove" onClick={() => patch({ holders: equity.holders.filter(x => x.id !== h.id) })}>×</button>
                  )}
                </td>
              </tr>
            ))}
            {equity.safes.map(s => {
              const conv = summary.safeConversions.find(c => c.safe.id === s.id);
              return (
                <tr key={s.id}>
                  <td className="eq-type">SAFE</td>
                  <td><input className="eq-in eq-in-name" value={s.name} onChange={e => setSafe(s.id, { name: e.target.value })} /></td>
                  <td className="num"><AcctInput className="eq-in" value={s.investment} onChange={n => setSafe(s.id, { investment: n })} /></td>
                  <td className="num"><AcctInput className="eq-in" value={s.valCap} onChange={n => setSafe(s.id, { valCap: n })} /></td>
                  <td className="num">
                    <span className="eq-pct">
                      <input className="eq-in" type="number" min={0} max={90} step={1}
                        value={Math.round(s.discount * 100)}
                        onChange={e => setSafe(s.id, { discount: Math.max(0, Math.min(90, Number(e.target.value))) / 100 })} />
                      <em>%</em>
                    </span>
                  </td>
                  <td className="num eq-computed" title={conv ? `${fmtCurrency(conv.price)} / share · converts on the ${conv.basis === 'discount' ? 'discount' : 'cap'}` : ''}>
                    {shares(conv?.shares ?? 0)}
                    {conv && equity.safeMode === 'postMoney' && <em className="eq-basis">{conv.basis}</em>}
                  </td>
                  <td><button type="button" className="eq-x" title="Remove" onClick={() => patch({ safes: equity.safes.filter(x => x.id !== s.id) })}>×</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="eq-adders">
          <button type="button" onClick={() => patch({ safes: [...equity.safes, { id: equityUid(), name: 'New SAFE', investment: 100_000, valCap: 5_000_000, discount: 0.2 }] })}>+ SAFE</button>
          <button type="button" onClick={() => patch({ holders: [...equity.holders, { id: equityUid(), kind: 'pool', name: 'New pool', shares: 100_000 }] })}>+ Pool</button>
          <button type="button" onClick={() => patch({ holders: [...equity.holders, { id: equityUid(), kind: 'advisory', name: 'New advisor', shares: 20_000 }] })}>+ Advisory</button>
        </div>
      </div>

      {/* ── Friends & Family — the SAFE block as its own round ── */}
      {equity.safes.length > 0 && (
        <div className="eq-section admin-card">
          <div className="eq-section-head">
            <h3>Friends &amp; Family</h3>
            <span>
              {fmtCurrency(equity.safes.reduce((a, s) => a + s.investment, 0), { compact: true })} raised
              across {equity.safes.length} SAFE{equity.safes.length === 1 ? '' : 's'} ·
              converts at the first priced round · no price per share yet
            </span>
          </div>
          <table className="eq-table">
            <thead>
              <tr><th>Type</th><th>Holder</th><th className="num">Investment</th><th className="num">Val cap</th><th className="num">Shares</th><th className="num">Ownership</th></tr>
            </thead>
            <tbody>
              {summary.foundationRows.map(r => (
                <tr key={r.id} className={r.group === 'safe' ? 'eq-row-new' : ''}>
                  <td className="eq-type">{r.type}</td>
                  <td>{r.name}</td>
                  <td className="num">{r.investment != null ? fmtCurrency(r.investment, { compact: true }) : '—'}</td>
                  <td className="num">{r.valCap != null ? fmtCurrency(r.valCap, { compact: true }) : '—'}</td>
                  <td className="num">{shares(r.shares)}</td>
                  <td className="num">{pct(r.pct)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {summary.foundationGroups.map(g => (
                <tr key={g.label}>
                  <td className="eq-type" colSpan={2}><i className="eq-dot" style={{ background: g.color }} />{g.label}</td>
                  <td className="num" />
                  <td className="num" />
                  <td className="num">{shares(g.shares)}</td>
                  <td className="num">{pct(g.pct)}</td>
                </tr>
              ))}
            </tfoot>
          </table>
          <div className="eq-bar" title="Ownership once the SAFEs convert, before any priced round">
            {summary.foundationGroups.map(g => (
              <span key={g.label} style={{ width: `${Math.max(0.4, g.pct * 100)}%`, background: g.color }} />
            ))}
          </div>
        </div>
      )}

      {/* ── Priced rounds ── */}
      {summary.stages.map(stage => (
        <div key={stage.round.id} className="eq-section admin-card">
          <div className="eq-section-head">
            <input className="eq-in eq-in-round" value={stage.round.name} onChange={e => setRound(stage.round.id, { name: e.target.value })} />
            <span>
              {fmtCurrency(stage.pricePerShare)} / share · post-money {fmtCurrency(stage.postMoney, { compact: true })}
              {stage.poolAdded > 0 ? ` · pool +${shares(stage.poolAdded)}` : ''}
            </span>
            <button type="button" className="eq-x" title="Remove round" onClick={() => patch({ rounds: equity.rounds.filter(r => r.id !== stage.round.id) })}>×</button>
          </div>

          <div className="eq-round-vars">
            <label><span>Pre-money</span><AcctInput className="eq-in" value={stage.round.preMoney} onChange={n => setRound(stage.round.id, { preMoney: n })} /></label>
            <label><span>Investment</span><AcctInput className="eq-in" value={stage.round.investment} onChange={n => setRound(stage.round.id, { investment: n })} /></label>
            <label>
              <span>Pool top-up (of post)</span>
              <span className="eq-pct">
                <input className="eq-in" type="number" min={0} max={50} step={1}
                  value={Math.round(stage.round.poolTopUp * 100)}
                  onChange={e => setRound(stage.round.id, { poolTopUp: Math.max(0, Math.min(50, Number(e.target.value))) / 100 })} />
                <em>%</em>
              </span>
            </label>
          </div>

          <table className="eq-table">
            <thead>
              <tr><th>Type</th><th>Holder</th><th className="num">Investment</th><th className="num">Equity value</th><th className="num">Shares</th><th className="num">Ownership</th></tr>
            </thead>
            <tbody>
              {stage.rows.map(r => (
                <tr key={r.id} className={r.id === stage.round.id ? 'eq-row-new' : ''}>
                  <td className="eq-type">{r.type}</td>
                  <td>{r.name}</td>
                  <td className="num">{r.investment != null ? fmtCurrency(r.investment, { compact: true }) : '—'}</td>
                  <td className="num">{fmtCurrency(r.equityValue, { compact: true })}</td>
                  <td className="num">{shares(r.shares)}</td>
                  <td className="num">{pct(r.pct)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {stage.groups.map(g => (
                <tr key={g.label}>
                  <td className="eq-type" colSpan={2}><i className="eq-dot" style={{ background: g.color }} />{g.label}</td>
                  <td className="num" />
                  <td className="num">{fmtCurrency(g.equityValue, { compact: true })}</td>
                  <td className="num">{shares(g.shares)}</td>
                  <td className="num">{pct(g.pct)}</td>
                </tr>
              ))}
            </tfoot>
          </table>

          <div className="eq-bar" title="Ownership after this round closes">
            {stage.groups.map(g => (
              <span key={g.label} style={{ width: `${Math.max(0.4, g.pct * 100)}%`, background: g.color }} />
            ))}
          </div>
        </div>
      ))}

      <div className="eq-adders eq-adders-rounds">
        <button type="button" onClick={() => patch({ rounds: [...equity.rounds, { id: equityUid(), name: addRoundName(), preMoney: (lastStage?.postMoney ?? 15_000_000) * 3, investment: (equity.rounds[equity.rounds.length - 1]?.investment ?? 2_500_000) * 2, poolTopUp: 0 }] })}>
          + Add round
        </button>
      </div>

      <p className="eq-foot">
        Post-money SAFE mode: each SAFE&rsquo;s ownership locks at investment ÷ cap against the company
        capitalization (everything outstanding including converting SAFEs, excluding the new round
        money); at the first priced round each note converts at the better of its cap price or
        (1 − discount) × round price. Pool top-ups add shares pre-money so existing holders absorb
        the dilution. Sheet mode reproduces the spreadsheet (cap ÷ founder shares).
        <button type="button" className="eq-reset" onClick={() => setEquity(EQUITY_DEFAULTS)}>Reset to spreadsheet defaults</button>
      </p>
    </div>
  );
}
