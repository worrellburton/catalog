// Admin → Model → Equity. The cap table, projected forward:
//   Foundation        — founders + early options (advisory, pools)
//   Friends & Family  — the SAFE notes (editable), converted shares
//   Priced rounds     — named investor checks stacked round by round
// Every number is editable; rows, investors and rounds add/remove; each
// section collapses. Two SAFE math modes: YC post-money (standard) and
// Sheet (reproduces the founder's spreadsheet). Shared live across admins.

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from '@remix-run/react';
import { fmtCurrency } from '~/services/projections';
import {
  computeEquity, equityUid, roundSize, suggestRoundInvestor, EQUITY_DEFAULTS,
  type CapHolder, type EquityState, type PricedRound, type SafeNote,
} from '~/services/equity';
import { useSharedEquity } from '~/hooks/useSharedEquity';
import ModelTabs from '~/components/model/ModelTabs';
import AcctInput from '~/components/model/AcctInput';
import EquityAdvisor from '~/components/model/EquityAdvisor';
import EquityLedger from '~/components/model/EquityLedger';

const pct = (v: number, dp = 2) => `${(v * 100).toFixed(dp)}%`;
const shares = (n: number) => n.toLocaleString('en-US');

const COLLAPSED_KEY = 'catalog:equity:collapsed:v1';
const readCollapsed = (): string[] => {
  try { return JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? '[]'); } catch { return []; }
};

export default function EquityPage() {
  const { equity, setEquity, live } = useSharedEquity();
  const summary = useMemo(() => computeEquity(equity), [equity]);
  const lastStage = summary.stages[summary.stages.length - 1];
  // The advisor IS this page's AI — the generic generation FAB retires
  // while Equity is mounted (CSS keys off this class).
  useEffect(() => {
    document.documentElement.classList.add('eq-page');
    return () => document.documentElement.classList.remove('eq-page');
  }, []);
  const [kaizenSignal, setKaizenSignal] = useState(0);
  // Rounds view (pricing events, full stage tables) vs Ledger view (one
  // chronological line per check — the stock-ledger read). Sticky.
  const [view, setView] = useState<'rounds' | 'ledger'>(() => {
    try { return window.localStorage.getItem('catalog:equity:view') === 'ledger' ? 'ledger' : 'rounds'; } catch { return 'rounds'; }
  });
  const pickView = (v: 'rounds' | 'ledger') => {
    setView(v);
    try { window.localStorage.setItem('catalog:equity:view', v); } catch { /* quota */ }
  };

  // Collapsed sections — a local view preference, not shared state.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(typeof window === 'undefined' ? [] : readCollapsed()));
  const toggle = (id: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    try { window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next])); } catch { /* quota */ }
    return next;
  });
  const Chevron = ({ id }: { id: string }) => (
    <button type="button" className={`eq-collapse${collapsed.has(id) ? ' is-closed' : ''}`}
      aria-label={collapsed.has(id) ? 'Expand' : 'Collapse'} onClick={() => toggle(id)}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
    </button>
  );

  const patch = (p: Partial<EquityState>) => setEquity(prev => ({ ...prev, ...p }));
  const setHolder = (id: string, p: Partial<CapHolder>) =>
    patch({ holders: equity.holders.map(h => (h.id === id ? { ...h, ...p } : h)) });
  const setSafe = (id: string, p: Partial<SafeNote>) =>
    patch({ safes: equity.safes.map(s => (s.id === id ? { ...s, ...p } : s)) });
  const setRound = (id: string, p: Partial<PricedRound>) =>
    patch({ rounds: equity.rounds.map(r => (r.id === id ? { ...r, ...p } : r)) });
  const setInvestor = (roundId: string, invId: string, p: Partial<{ name: string; investment: number }>) =>
    patch({
      rounds: equity.rounds.map(r => r.id === roundId
        ? { ...r, investors: r.investors.map(i => (i.id === invId ? { ...i, ...p } : i)) }
        : r),
    });
  const removeInvestor = (roundId: string, invId: string) =>
    patch({ rounds: equity.rounds.map(r => r.id === roundId ? { ...r, investors: r.investors.filter(i => i.id !== invId) } : r) });
  const addInvestor = (roundId: string) =>
    patch({
      rounds: equity.rounds.map(r => r.id === roundId
        ? { ...r, investors: [...r.investors, suggestRoundInvestor(r)] }
        : r),
    });

  const addRoundName = () => {
    const letters = ['Seed', 'Series A', 'Series B', 'Series C', 'Series D', 'Series E'];
    return letters[Math.min(equity.rounds.length, letters.length - 1)];
  };

  const ffTotal = equity.safes.reduce((a, s) => a + s.investment, 0);

  // Every participant has their own page — ↗ next to a name opens it.
  const OpenHolder = ({ hid }: { hid: string }) => (
    <Link className="eq-open" to={`/admin/model/equity/holder/${hid}`} title="Open this holder's page">↗</Link>
  );

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
          The cap table projected forward: foundation, the Friends &amp; Family SAFEs, then every
          priced round with its named checks. Edit anything; dilution cascades.
        </p>
      </div>

      <div className="eq-toprow">
        <ModelTabs active="equity" />
        <div className="eq-mode" role="group" aria-label="Equity view">
          <button type="button" className={view === 'rounds' ? 'is-active' : ''} onClick={() => pickView('rounds')}>Rounds</button>
          <button type="button" className={view === 'ledger' ? 'is-active' : ''} onClick={() => pickView('ledger')}>Ledger</button>
        </div>
        <button
          type="button"
          className="eq-kaizen"
          title="One-tap audit: round sizing, valuations, pools, SAFE terms — recommendations with numbers, applyable"
          onClick={() => setKaizenSignal(s => s + 1)}
        >
          改 Kaizen
        </button>
      </div>

      {/* ── Headline ── */}
      <div className="eq-band">
        <div className="eq-stat">
          <span className="eq-stat-label">Founders at {lastStage?.round.name ?? 'today'}</span>
          <b>{pct(lastStage ? (lastStage.rows.find(r => r.group === 'founders')?.pct ?? 0) : 1)}</b>
          <i>worth {fmtCurrency(lastStage?.rows.find(r => r.group === 'founders')?.equityValue ?? 0, { compact: true })}</i>
        </div>
        <div className="eq-stat">
          <span className="eq-stat-label">Total new money</span>
          <b>{fmtCurrency(ffTotal + equity.rounds.reduce((a, r) => a + roundSize(r), 0), { compact: true })}</b>
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

      {view === 'ledger' && (
        <EquityLedger
          equity={equity}
          summary={summary}
          onSafe={setSafe}
          onInvestor={setInvestor}
          onAddSafe={() => patch({ safes: [...equity.safes, { id: equityUid(), name: 'New investor', investment: 100_000, valCap: 5_000_000, discount: 0.2 }] })}
        />
      )}

      {view === 'rounds' && (<>
      {/* ── Foundation: founders + early options only ── */}
      <div className="eq-section admin-card">
        <div className="eq-section-head">
          <Chevron id="foundation" />
          <h3>Foundation</h3>
          <span>{shares(summary.foundersShares)} founder shares · {shares(summary.optionShares)} option shares</span>
        </div>
        {!collapsed.has('foundation') && (
          <>
            <table className="eq-table">
              <thead>
                <tr><th>Type</th><th>Holder</th><th className="num">Shares</th><th /></tr>
              </thead>
              <tbody>
                {equity.holders.map(h => (
                  <tr key={h.id}>
                    <td className="eq-type" data-l="Type">{h.kind === 'founders' ? 'Founders' : h.kind === 'advisory' ? 'Advisory' : 'Pool'}</td>
                    <td className="eq-namecell" data-l="Holder"><input className="eq-in eq-in-name" value={h.name} onChange={e => setHolder(h.id, { name: e.target.value })} /><OpenHolder hid={h.id} /></td>
                    <td className="num" data-l="Shares"><AcctInput className="eq-in" value={h.shares} onChange={n => setHolder(h.id, { shares: n })} /></td>
                    <td>
                      {h.kind !== 'founders' && (
                        <button type="button" className="eq-x" title="Remove" onClick={() => patch({ holders: equity.holders.filter(x => x.id !== h.id) })}>×</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="eq-adders">
              <button type="button" onClick={() => patch({ holders: [...equity.holders, { id: equityUid(), kind: 'pool', name: 'New pool', shares: 100_000 }] })}>+ Pool</button>
              <button type="button" onClick={() => patch({ holders: [...equity.holders, { id: equityUid(), kind: 'advisory', name: 'New advisor', shares: 20_000 }] })}>+ Advisory</button>
            </div>
          </>
        )}
      </div>

      {/* ── Friends & Family: the SAFE notes ── */}
      <div className="eq-section admin-card">
        <div className="eq-section-head">
          <Chevron id="ff" />
          <h3>Friends &amp; Family</h3>
          <span>
            {fmtCurrency(ffTotal, { compact: true })} raised across {equity.safes.length} SAFE{equity.safes.length === 1 ? '' : 's'} ·
            converts at the first priced round
          </span>
        </div>
        {!collapsed.has('ff') && (
          <>
            {/* Same format as the priced rounds: the FULL table with the
                round's new money (the SAFEs) highlighted and editable;
                founders/pools read as context rows, exactly like later
                rounds show earlier holders. */}
            <table className="eq-table">
              <thead>
                <tr><th>Type</th><th>Holder</th><th className="num">Investment</th><th className="num">Val cap</th><th className="num">Discount</th><th className="num">Shares</th><th className="num">Ownership</th><th /></tr>
              </thead>
              <tbody>
                {summary.foundationRows.map(r => {
                  const s = equity.safes.find(x => x.id === r.id);
                  const conv = s ? summary.safeConversions.find(c => c.safe.id === s.id) : null;
                  return (
                    <tr key={r.id} className={s ? 'eq-row-new' : ''}>
                      <td className="eq-type" data-l="Type">{r.type}</td>
                      <td className="eq-namecell" data-l="Holder">
                        {s
                          ? <><input className="eq-in eq-in-name" value={s.name} onChange={e => setSafe(s.id, { name: e.target.value })} /><OpenHolder hid={s.id} /></>
                          : <Link className="eq-namelink" to={`/admin/model/equity/holder/${r.id}`}>{r.name}</Link>}
                      </td>
                      <td className="num" data-l="Investment">{s ? <AcctInput className="eq-in" value={s.investment} onChange={n => setSafe(s.id, { investment: n })} /> : '—'}</td>
                      <td className="num" data-l="Val cap">{s ? <AcctInput className="eq-in" value={s.valCap} onChange={n => setSafe(s.id, { valCap: n })} /> : '—'}</td>
                      <td className="num" data-l="Discount">
                        {s ? (
                          <span className="eq-pct">
                            <input className="eq-in" type="number" min={0} max={90} step={1}
                              value={Math.round(s.discount * 100)}
                              onChange={e => setSafe(s.id, { discount: Math.max(0, Math.min(90, Number(e.target.value))) / 100 })} />
                            <em>%</em>
                          </span>
                        ) : '—'}
                      </td>
                      <td className={`num${s ? ' eq-computed' : ''}`} data-l="Shares" title={conv ? `${fmtCurrency(conv.price)} / share · converts on the ${conv.basis === 'discount' ? 'discount' : 'cap'}` : ''}>
                        {shares(r.shares)}
                        {conv && equity.safeMode === 'postMoney' && <em className="eq-basis">{conv.basis}</em>}
                      </td>
                      <td className="num" data-l="Ownership">{pct(r.pct)}</td>
                      <td>{s && <button type="button" className="eq-x" title="Remove" onClick={() => patch({ safes: equity.safes.filter(x => x.id !== s.id) })}>×</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                {summary.foundationGroups.map(g => (
                  <tr key={g.label}>
                    <td className="eq-type" colSpan={2}><i className="eq-dot" style={{ background: g.color }} />{g.label}</td>
                    <td className="num" />
                    <td className="num" />
                    <td className="num" />
                    <td className="num">{shares(g.shares)}</td>
                    <td className="num">{pct(g.pct)}</td>
                    <td />
                  </tr>
                ))}
              </tfoot>
            </table>
            <div className="eq-adders">
              <button type="button" onClick={() => patch({ safes: [...equity.safes, { id: equityUid(), name: 'New SAFE', investment: 100_000, valCap: 5_000_000, discount: 0.2 }] })}>+ SAFE</button>
            </div>
            <div className="eq-bar" title="Ownership once the SAFEs convert, before any priced round">
              {summary.foundationGroups.map(g => (
                <span key={g.label} style={{ width: `${Math.max(0.4, g.pct * 100)}%`, background: g.color }} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Priced rounds ── */}
      {summary.stages.map(stage => (
        <div key={stage.round.id} className="eq-section admin-card">
          <div className="eq-section-head">
            <Chevron id={stage.round.id} />
            <input className="eq-in eq-in-round" value={stage.round.name} onChange={e => setRound(stage.round.id, { name: e.target.value })} />
            <span>
              {fmtCurrency(roundSize(stage.round), { compact: true })} raised · {fmtCurrency(stage.pricePerShare)} / share ·
              post-money {fmtCurrency(stage.postMoney, { compact: true })}
              {stage.poolAdded > 0 ? ` · pool +${shares(stage.poolAdded)}` : ''}
            </span>
            <button type="button" className="eq-x" title="Remove round" onClick={() => patch({ rounds: equity.rounds.filter(r => r.id !== stage.round.id) })}>×</button>
          </div>

          {!collapsed.has(stage.round.id) && (
            <>
              <div className="eq-round-vars">
                <label><span>Pre-money</span><AcctInput className="eq-in" value={stage.round.preMoney} onChange={n => setRound(stage.round.id, { preMoney: n })} /></label>
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
                  <tr><th>Type</th><th>Holder</th><th className="num">Investment</th><th className="num">Equity value</th><th className="num">Shares</th><th className="num">Ownership</th><th /></tr>
                </thead>
                <tbody>
                  {stage.rows.map((r, idx) => {
                    const inv = stage.round.investors.find(i => i.id === r.id);
                    // The round's own checks read as one labeled group at
                    // the bottom of the table (founder's call) — a divider
                    // marks where existing holders end and new money begins.
                    const firstOwn = !!inv && !stage.rows.slice(0, idx).some(p => stage.round.investors.some(i => i.id === p.id));
                    return (
                      <Fragment key={r.id}>
                      {firstOwn && (
                        <tr className="eq-group-row">
                          <td colSpan={7}>{stage.round.name} investors — new money this round</td>
                        </tr>
                      )}
                      <tr className={inv ? 'eq-row-new' : ''}>
                        <td className="eq-type" data-l="Type">{r.type}</td>
                        <td className="eq-namecell" data-l="Holder">
                          {inv
                            ? <><input className="eq-in eq-in-name" value={inv.name} onChange={e => setInvestor(stage.round.id, inv.id, { name: e.target.value })} /><OpenHolder hid={inv.id} /></>
                            : <Link className="eq-namelink" to={`/admin/model/equity/holder/${r.id}`}>{r.name}</Link>}
                        </td>
                        <td className="num" data-l="Investment">
                          {inv
                            ? <AcctInput className="eq-in" value={inv.investment} onChange={n => setInvestor(stage.round.id, inv.id, { investment: n })} />
                            : r.investment != null ? fmtCurrency(r.investment, { compact: true }) : '—'}
                        </td>
                        <td className="num" data-l="Equity value">{fmtCurrency(r.equityValue, { compact: true })}</td>
                        <td className="num" data-l="Shares">{shares(r.shares)}</td>
                        <td className="num" data-l="Ownership">{pct(r.pct)}</td>
                        <td>
                          {inv && (
                            <button type="button" className="eq-x" title="Remove investor" onClick={() => removeInvestor(stage.round.id, inv.id)}>×</button>
                          )}
                        </td>
                      </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  {stage.groups.map(g => (
                    <tr key={g.label}>
                      <td className="eq-type" colSpan={2}><i className="eq-dot" style={{ background: g.color }} />{g.label}</td>
                      <td className="num" />
                      <td className="num">{fmtCurrency(g.equityValue, { compact: true })}</td>
                      <td className="num">{shares(g.shares)}</td>
                      <td className="num">{pct(g.pct)}</td>
                      <td />
                    </tr>
                  ))}
                </tfoot>
              </table>

              <div className="eq-adders">
                <button
                  type="button"
                  title="Adds a check with thought-out terms: rounds build to ~20% dilution, the lead anchors ~60%, later checks fill the gap — name and size come pre-fit, everything stays editable"
                  onClick={() => addInvestor(stage.round.id)}
                >
                  + Investor
                </button>
              </div>

              <div className="eq-bar" title="Ownership after this round closes">
                {stage.groups.map(g => (
                  <span key={g.label} style={{ width: `${Math.max(0.4, g.pct * 100)}%`, background: g.color }} />
                ))}
              </div>
            </>
          )}
        </div>
      ))}

      <div className="eq-adders eq-adders-rounds">
        <button type="button" onClick={() => patch({ rounds: [...equity.rounds, { id: equityUid(), name: addRoundName(), preMoney: (lastStage?.postMoney ?? 15_000_000) * 3, poolTopUp: 0, investors: [{ id: equityUid(), name: 'Lead investor', investment: roundSize(equity.rounds[equity.rounds.length - 1] ?? { investors: [] } as unknown as PricedRound) * 2 || 2_500_000 }] }] })}>
          + Add round
        </button>
      </div>
      </>)}

      <p className="eq-foot">
        Post-money SAFE mode: each SAFE&rsquo;s ownership locks at investment ÷ cap against the company
        capitalization (everything outstanding including converting SAFEs, excluding the new round
        money); at the first priced round each note converts at the better of its cap price or
        (1 − discount) × round price. Pool top-ups add shares pre-money so existing holders absorb
        the dilution. Sheet mode reproduces the spreadsheet (cap ÷ founder shares).
        <button type="button" className="eq-reset" onClick={() => setEquity(EQUITY_DEFAULTS)}>Reset to spreadsheet defaults</button>
      </p>

      <EquityAdvisor equity={equity} onApply={setEquity} kaizenSignal={kaizenSignal} />
    </div>
  );
}
