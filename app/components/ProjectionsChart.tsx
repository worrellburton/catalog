import { useMemo, useState } from 'react';
import {
  type MonthBreakdown,
  MONTHS,
  monthLabel,
  fmtCurrency,
  fmtNumber,
  niceCeiling,
} from '~/services/projections';

interface ChartProps {
  series: MonthBreakdown[]; // length === MONTHS
}

interface DeltaRow {
  label: string;
  current: string;
  delta: string;
  positive: boolean;
}

function pctChange(curr: number, prev: number | undefined): { text: string; positive: boolean } {
  if (prev === undefined || prev === 0) return { text: ' - ', positive: true };
  const pct = (curr - prev) / prev;
  const sign = pct >= 0 ? '+' : '';
  return { text: `${sign}${(pct * 100).toFixed(pct >= 1 ? 0 : 1)}%`, positive: pct >= 0 };
}

export default function ProjectionsChart({ series }: ChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const W = 1200, H = 420;
  const PAD_L = 70, PAD_R = 24, PAD_T = 24, PAD_B = 44;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const TIP_W = 240, TIP_H = 196;

  const revenues = series.map(s => s.revenue);
  const max = Math.max(1, ...revenues);
  const niceMax = niceCeiling(max);

  const xFor = (i: number) => PAD_L + (innerW * i) / (MONTHS - 1);
  const yFor = (v: number) => PAD_T + innerH - (innerH * v) / niceMax;

  const gridSteps = [0, 0.25, 0.5, 0.75, 1];

  const areaPath = useMemo(() => {
    if (series.length === 0) return '';
    const points = series.map((s, i) => ({ x: xFor(i), y: yFor(s.revenue) }));
    let d = `M ${points[0].x} ${PAD_T + innerH} L ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const p0 = points[i - 1];
      const p1 = points[i];
      const cp1x = p0.x + (p1.x - p0.x) / 2;
      d += ` C ${cp1x} ${p0.y}, ${cp1x} ${p1.y}, ${p1.x} ${p1.y}`;
    }
    d += ` L ${points[points.length - 1].x} ${PAD_T + innerH} Z`;
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series.map(s => s.revenue).join('|'), niceMax]);

  const linePath = useMemo(() => {
    if (series.length === 0) return '';
    const points = series.map((s, i) => ({ x: xFor(i), y: yFor(s.revenue) }));
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const p0 = points[i - 1];
      const p1 = points[i];
      const cp1x = p0.x + (p1.x - p0.x) / 2;
      d += ` C ${cp1x} ${p0.y}, ${cp1x} ${p1.y}, ${p1.x} ${p1.y}`;
    }
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series.map(s => s.revenue).join('|'), niceMax]);

  const buildTooltipRows = (idx: number): DeltaRow[] => {
    const cur = series[idx];
    const prevMonth = idx >= 1 ? series[idx - 1] : undefined;
    const prevYear = idx >= 12 ? series[idx - 12] : undefined;

    const mau = pctChange(cur.mau, prevMonth?.mau);
    const rev = pctChange(cur.revenue, prevMonth?.revenue);
    const yoyRev = prevYear ? pctChange(cur.revenue, prevYear.revenue) : null;

    const rows: DeltaRow[] = [
      { label: 'MAU',         current: fmtNumber(cur.mau),         delta: `${mau.text} MoM`, positive: mau.positive },
      { label: 'Sessions',    current: fmtNumber(cur.sessions),    delta: `${cur.sessions >= 1_000_000 ? (cur.sessions / 1_000_000).toFixed(1) + 'M' : (cur.sessions / 1_000).toFixed(0) + 'K'}`, positive: true },
      { label: 'Impressions', current: fmtNumber(cur.impressions), delta: `${(cur.impressions / 1_000_000).toFixed(2)}M`, positive: true },
      { label: 'Sales',       current: fmtNumber(cur.sales),       delta: `GMV ${fmtCurrency(cur.gmv, { compact: true })}`, positive: true },
      { label: 'Revenue',     current: fmtCurrency(cur.revenue),   delta: `${rev.text} MoM`, positive: rev.positive },
    ];
    if (yoyRev) {
      rows.push({ label: 'YoY revenue', current: fmtCurrency(prevYear!.revenue), delta: `${yoyRev.text} YoY`, positive: yoyRev.positive });
    }
    return rows;
  };

  return (
    <div className="proj-chart-wrap">
      <svg className="proj-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="proj-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#10b981" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.04" />
          </linearGradient>
        </defs>

        {gridSteps.map((t, i) => {
          const y = PAD_T + innerH * (1 - t);
          return (
            <g key={`grid-${i}`}>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#e5e7eb" strokeDasharray="3 4" />
              <text x={PAD_L - 10} y={y + 4} textAnchor="end" fontSize="11" fill="#6b7280">
                {fmtCurrency(niceMax * t, { compact: true })}
              </text>
            </g>
          );
        })}

        <path d={areaPath} fill="url(#proj-grad)" />
        <path d={linePath} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

        {series.map((s, i) => {
          const x = xFor(i);
          const y = yFor(s.revenue);
          const isHover = hoverIdx === i;
          return (
            <g key={`pt-${i}`}>
              <circle cx={x} cy={y} r={isHover ? 6 : 3.5} fill="#fff" stroke="#10b981" strokeWidth={isHover ? 3 : 2} style={{ pointerEvents: 'none' }} />
              <rect
                x={x - 28} y={PAD_T} width={56} height={innerH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(prev => (prev === i ? null : prev))}
                style={{ cursor: 'pointer' }}
              />
              <text
                x={x} y={H - PAD_B + 18}
                textAnchor="middle" fontSize="10" fill="#6b7280"
                style={{ fontWeight: isHover ? 700 : 500 }}
              >
                {monthLabel(i)}
              </text>
            </g>
          );
        })}

        {hoverIdx !== null && (() => {
          const i = hoverIdx;
          const x = xFor(i);
          const y = yFor(series[i].revenue);
          const tipX = Math.min(W - PAD_R - TIP_W, Math.max(PAD_L, x - TIP_W / 2));
          const tipY = Math.max(PAD_T, y - TIP_H - 14);
          const rows = buildTooltipRows(i);
          return (
            <g>
              <line x1={x} y1={PAD_T} x2={x} y2={PAD_T + innerH} stroke="#10b981" strokeDasharray="2 3" style={{ pointerEvents: 'none' }} />
              <foreignObject
                x={tipX}
                y={tipY}
                width={TIP_W}
                height={TIP_H}
                style={{ overflow: 'visible', pointerEvents: 'none' }}
              >
                <div className="proj-tooltip">
                  <div className="proj-tooltip-head">
                    <span className="proj-tooltip-month">{monthLabel(i)}</span>
                    <span className="proj-tooltip-revenue">{fmtCurrency(series[i].revenue)}</span>
                  </div>
                  <div className="proj-tooltip-rows">
                    {rows.map(r => (
                      <div key={r.label} className="proj-tooltip-row">
                        <span className="proj-tooltip-row-label">{r.label}</span>
                        <span className="proj-tooltip-row-current">{r.current}</span>
                        <span className={`proj-tooltip-row-delta ${r.positive ? 'positive' : 'negative'}`}>{r.delta}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </foreignObject>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}
