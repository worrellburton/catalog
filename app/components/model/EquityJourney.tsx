// The Dilution Journey — the Equity page's establishing shot. One
// aligned ownership bar per stage (F&F through the last round) so the
// founder watches their slice evolve at a glance; clicking a stage
// jumps to (and expands) that round's card below.

import { fmtCurrency } from '~/services/projections';
import { EQUITY_GROUP_COLORS, type EquitySummary } from '~/services/equity';

const pct = (v: number, dp = 1) => `${(v * 100).toFixed(dp)}%`;

export default function EquityJourney({ summary, onJump }: {
  summary: EquitySummary;
  onJump: (sectionId: string) => void;
}) {
  const stages = [
    {
      id: 'ff',
      label: 'Friends & Family',
      sub: 'unpriced',
      groups: summary.foundationGroups,
    },
    ...summary.stages.map(s => ({
      id: s.round.id,
      label: s.round.name,
      sub: `${fmtCurrency(s.postMoney, { compact: true })} post`,
      groups: s.groups,
    })),
  ];

  return (
    <div className="eqj">
      <div className="eqj-head">
        <span className="eqj-title">Dilution journey</span>
        <span className="eqj-legend">
          {(['founders', 'advisory', 'pool', 'investors'] as const).map(k => (
            <span key={k}>
              <i style={{ background: EQUITY_GROUP_COLORS[k] }} />
              {k === 'pool' ? 'pools' : k}
            </span>
          ))}
        </span>
      </div>
      {stages.map(s => {
        const founders = s.groups.find(g => g.label === 'Founders')?.pct ?? 0;
        return (
          <button key={s.id} type="button" className="eqj-row" onClick={() => onJump(s.id)} title={`Jump to ${s.label}`}>
            <span className="eqj-label">
              {s.label}
              <em>{s.sub}</em>
            </span>
            <span className="eqj-bar">
              {s.groups.map(g => (
                g.pct > 0.001 && (
                  <i
                    key={g.label}
                    style={{ width: `${g.pct * 100}%`, background: g.color }}
                    title={`${g.label} ${pct(g.pct)}`}
                  />
                )
              ))}
            </span>
            <b className="eqj-founders">{pct(founders)}</b>
          </button>
        );
      })}
    </div>
  );
}
