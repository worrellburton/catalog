import { useMemo, useState } from 'react';
import {
  type GtmMonth,
} from '~/services/go-to-market';
import {
  MONTHS,
  monthLabel,
  fmtCurrency,
  fmtNumber,
  niceCeiling,
} from '~/services/projections';

interface ChartProps {
  series: GtmMonth[]; // length === MONTHS
}

const PAID = '#6366f1';    // indigo — bought growth
const ORGANIC = '#10b981'; // green — earned growth (echoes Projections)

// Smooth cubic path through a set of points. Shared by both the fill
// areas and the stroke line so the curve matches exactly.
function smoothLine(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const cpx = p0.x + (p1.x - p0.x) / 2;
    d += ` C ${cpx} ${p0.y}, ${cpx} ${p1.y}, ${p1.x} ${p1.y}`;
  }
  return d;
}

export default function GoToMarketChart({ series }: ChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const W = 1200, H = 420;
  const PAD_L = 70, PAD_R = 24, PAD_T = 24, PAD_B = 44;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const TIP_W = 240, TIP_H = 196;

  const max = Math.max(1, ...series.map(s => s.newUsers));
  const niceMax = niceCeiling(max);

  const xFor = (i: number) => PAD_L + (innerW * i) / (MONTHS - 1);
  const yFor = (v: number) => PAD_T + innerH - (innerH * v) / niceMax;

  const gridSteps = [0, 0.25, 0.5, 0.75, 1];

  const key = series.map(s => `${Math.round(s.paidAdds)}-${Math.round(s.organicAdds)}`).join('|');

  // Paid sits on the baseline; organic stacks on top of paid so the
  // outer edge of the band is total monthly adds.
  const { paidArea, totalArea, totalLine } = useMemo(() => {
    const paidPts = series.map((s, i) => ({ x: xFor(i), y: yFor(s.paidAdds) }));
    const totalPts = series.map((s, i) => ({ x: xFor(i), y: yFor(s.newUsers) }));
    const baseY = PAD_T + innerH;

    const paidArea =
      `${smoothLine(paidPts)} L ${paidPts[paidPts.length - 1].x} ${baseY} L ${paidPts[0].x} ${baseY} Z`;

    // Organic band: top edge = total curve, bottom edge = paid curve
    // (traversed in reverse to close the ribbon).
    const totalArea =
      `${smoothLine(totalPts)} ` +
      `L ${paidPts[paidPts.length - 1].x} ${paidPts[paidPts.length - 1].y} ` +
      smoothLine([...paidPts].reverse()).replace(/^M/, 'L') +
      ' Z';

    return { paidArea, totalArea, totalLine: smoothLine(totalPts) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, niceMax]);

  return (
    <div className="proj-chart-wrap">
      <div className="gtm-legend">
        <span className="gtm-legend-item"><i style={{ background: ORGANIC }} /> Organic</span>
        <span className="gtm-legend-item"><i style={{ background: PAID }} /> Paid</span>
      </div>
      <svg className="proj-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="gtm-paid-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={PAID} stopOpacity="0.55" />
            <stop offset="100%" stopColor={PAID} stopOpacity="0.06" />
          </linearGradient>
          <linearGradient id="gtm-organic-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ORGANIC} stopOpacity="0.5" />
            <stop offset="100%" stopColor={ORGANIC} stopOpacity="0.05" />
          </linearGradient>
        </defs>

        {gridSteps.map((t, i) => {
          const y = PAD_T + innerH * (1 - t);
          return (
            <g key={`grid-${i}`}>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#e5e7eb" strokeDasharray="3 4" />
              <text x={PAD_L - 10} y={y + 4} textAnchor="end" fontSize="11" fill="#6b7280">
                {fmtNumber(niceMax * t)}
              </text>
            </g>
          );
        })}

        <path d={totalArea} fill="url(#gtm-organic-grad)" />
        <path d={paidArea} fill="url(#gtm-paid-grad)" />
        <path d={totalLine} fill="none" stroke={ORGANIC} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

        {series.map((s, i) => {
          const x = xFor(i);
          const y = yFor(s.newUsers);
          const isHover = hoverIdx === i;
          return (
            <g key={`pt-${i}`}>
              <circle cx={x} cy={y} r={isHover ? 6 : 3.5} fill="#fff" stroke={ORGANIC} strokeWidth={isHover ? 3 : 2} style={{ pointerEvents: 'none' }} />
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
          const s = series[i];
          const x = xFor(i);
          const y = yFor(s.newUsers);
          const tipX = Math.min(W - PAD_R - TIP_W, Math.max(PAD_L, x - TIP_W / 2));
          const tipY = Math.max(PAD_T, y - TIP_H - 14);
          const rows = [
            { label: 'Spend', value: fmtCurrency(s.spend, { compact: true }), tone: 'paid' },
            { label: 'Paid adds', value: fmtNumber(s.paidAdds), tone: 'paid' },
            { label: 'Organic adds', value: fmtNumber(s.organicAdds), tone: 'organic' },
            { label: 'Total adds', value: fmtNumber(s.newUsers), tone: 'organic' },
            { label: 'Cumulative users', value: fmtNumber(s.cumulativeUsers), tone: 'neutral' },
            { label: 'Blended CAC', value: fmtCurrency(s.blendedCacToDate), tone: 'neutral' },
          ];
          return (
            <g>
              <line x1={x} y1={PAD_T} x2={x} y2={PAD_T + innerH} stroke={ORGANIC} strokeDasharray="2 3" style={{ pointerEvents: 'none' }} />
              <foreignObject x={tipX} y={tipY} width={TIP_W} height={TIP_H} style={{ overflow: 'visible', pointerEvents: 'none' }}>
                <div className="proj-tooltip">
                  <div className="proj-tooltip-head">
                    <span className="proj-tooltip-month">{monthLabel(i)}</span>
                    <span className="proj-tooltip-revenue">{fmtNumber(s.newUsers)}</span>
                  </div>
                  <div className="proj-tooltip-rows">
                    {rows.map(r => (
                      <div key={r.label} className="proj-tooltip-row">
                        <span className="proj-tooltip-row-label">{r.label}</span>
                        <span className="proj-tooltip-row-current">{r.value}</span>
                        <span className={`proj-tooltip-row-delta ${r.tone === 'paid' ? 'gtm-paid' : r.tone === 'organic' ? 'positive' : ''}`}>
                          {r.tone === 'paid' ? 'paid' : r.tone === 'organic' ? 'organic' : ''}
                        </span>
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
