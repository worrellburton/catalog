// Admin → Model → Equity. The fundraise calculator: Friends & Family,
// Pre-seed and Seed as editable rounds (raise, pre-money, option pool,
// monthly burn) flowing through a dilution waterfall — post-money, what
// each round's investors own, what the founders keep at every stage,
// and how many months each check buys. Numbers are shared live across
// admins like the rest of the model.

import { useMemo } from 'react';
import { fmtCurrency } from '~/services/projections';
import { computeEquity, EQUITY_DEFAULTS, type EquityRound } from '~/services/equity';
import { useSharedEquity } from '~/hooks/useSharedEquity';
import ModelTabs from '~/components/model/ModelTabs';
import AcctInput from '~/components/model/AcctInput';

const pct = (v: number, dp = 1) => `${(v * 100).toFixed(dp)}%`;

export default function EquityPage() {
  const { equity, setEquity, live } = useSharedEquity();
  const outcomes = useMemo(() => computeEquity(equity), [equity]);
  const last = outcomes[outcomes.length - 1];

  const setRound = (id: EquityRound['id'], patch: Partial<EquityRound>) =>
    setEquity(prev => ({
      ...prev,
      rounds: prev.rounds.map(r => (r.id === id ? { ...r, ...patch } : r)),
    }));

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
          The fundraise, round by round: how big each check is, what it values the company at,
          and what everyone owns after. Edit any number — dilution cascades through every later round.
        </p>
      </div>

      <ModelTabs active="equity" />

      {/* ── Headline: where the journey ends ── */}
      <div className="eq-band">
        <div className="eq-stat">
          <span className="eq-stat-label">Total raised</span>
          <b>{fmtCurrency(last?.cumulativeRaised ?? 0, { compact: true })}</b>
          <i>across {equity.rounds.length} rounds</i>
        </div>
        <div className="eq-stat">
          <span className="eq-stat-label">Founders after Seed</span>
          <b>{pct(last?.foundersAfter ?? 1)}</b>
          <i>of the company</i>
        </div>
        <div className="eq-stat">
          <span className="eq-stat-label">Seed post-money</span>
          <b>{fmtCurrency(last?.postMoney ?? 0, { compact: true })}</b>
          <i>founders&rsquo; stake ≈ {fmtCurrency((last?.postMoney ?? 0) * (last?.foundersAfter ?? 0), { compact: true })}</i>
        </div>
        <div className="eq-stat">
          <span className="eq-stat-label">Monthly burn</span>
          <AcctInput
            className="eq-in eq-in-burn"
            value={equity.monthlyBurn}
            onChange={n => setEquity(prev => ({ ...prev, monthlyBurn: n }))}
          />
          <i>drives the runway each round buys</i>
        </div>
      </div>

      {/* ── The rounds ── */}
      <div className="eq-rounds">
        {outcomes.map(o => (
          <div key={o.round.id} className="eq-round admin-card">
            <div className="eq-round-head">
              <h3>{o.round.name}</h3>
              <span className="eq-round-runway">{o.runwayMonths.toFixed(0)} mo runway</span>
            </div>

            <label className="eq-field">
              <span>Raise</span>
              <AcctInput className="eq-in" value={o.round.raise} onChange={n => setRound(o.round.id, { raise: n })} />
            </label>
            <label className="eq-field">
              <span>Pre-money / cap</span>
              <AcctInput className="eq-in" value={o.round.preMoney} onChange={n => setRound(o.round.id, { preMoney: n })} />
            </label>
            <label className="eq-field">
              <span>Option pool (of post)</span>
              <span className="eq-pct">
                <input
                  className="eq-in"
                  type="number"
                  min={0}
                  max={50}
                  step={1}
                  value={Math.round(o.round.optionPool * 100)}
                  onChange={e => setRound(o.round.id, { optionPool: Math.max(0, Math.min(50, Number(e.target.value))) / 100 })}
                />
                <em>%</em>
              </span>
            </label>

            <div className="eq-derived">
              <div><span>Post-money</span><b>{fmtCurrency(o.postMoney, { compact: true })}</b></div>
              <div><span>New investors own</span><b>{pct(o.investorPct)}</b></div>
              {o.poolPct > 0 && <div><span>Pool carved</span><b>{pct(o.poolPct, 0)}</b></div>}
              <div><span>Founders give up</span><b>{pct(o.roundDilution)}</b></div>
              <div className="eq-derived-founders"><span>Founders after</span><b>{pct(o.foundersAfter)}</b></div>
            </div>

            {/* Cap table at this stage */}
            <div className="eq-bar" title="Cap table after this round closes">
              {o.capTable.map(s => (
                <span key={s.label} style={{ width: `${Math.max(0.5, s.pct * 100)}%`, background: s.color }} />
              ))}
            </div>
            <div className="eq-bar-legend">
              {o.capTable.map(s => (
                <span key={s.label}>
                  <i style={{ background: s.color }} />
                  {s.label} {pct(s.pct)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="eq-foot">
        Priced-equivalent math: post = pre + raise; the new money owns raise ÷ post; pools carve out
        of post and dilute everyone who came before. SAFEs converting at their cap land on ~the same
        numbers. <button type="button" className="eq-reset" onClick={() => setEquity(EQUITY_DEFAULTS)}>Reset to defaults</button>
      </p>
    </div>
  );
}
