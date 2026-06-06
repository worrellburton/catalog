import { useMemo, useState } from 'react';
import type { MonthBreakdown } from '~/services/projections';
import type { GtmMonth } from '~/services/go-to-market';
import {
  MONTHS,
  monthLabel,
  fmtCurrency,
  fmtNumber,
  niceCeiling,
} from '~/services/projections';

interface ChartProps {
  revenue: MonthBreakdown[];
  acquisition: GtmMonth[];
  showRevenue: boolean;
  showAcquisition: boolean;
}

const REVENUE = '#10b981'; // green — revenue ($, left axis)
const ACQ = '#6366f1';     // indigo — MAU (count, right axis)

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

function pctChange(curr: number, prev: number | undefined): { text: string; positive: boolean } {
  if (prev === undefined || prev === 0) return { text: ' - ', positive: true };
  const pct = (curr - prev) / prev;
  const sign = pct >= 0 ? '+' : '';
  return { text: `${sign}${(pct * 100).toFixed(pct >= 1 ? 0 : 1)}%`, positive: pct >= 0 };
}

export default function UnifiedModelChart({ revenue, acquisition, showRevenue, showAcquisition }: ChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const W = 1200, H = 440;
  const PAD_L = 72, PAD_R = 72, PAD_T = 24, PAD_B = 44;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const TIP_W = 240, TIP_H = 180;

  const revMax = niceCeiling(Math.max(1, ...revenue.map(s => s.revenue)));
  const acqMax = niceCeiling(Math.max(1, ...acquisition.map(s => s.cumulativeUsers)));

  const xFor = (i: number) => PAD_L + (innerW * i) / (MONTHS - 1);
  const yRev = (v: number) => PAD_T + innerH - (innerH * v) / revMax;
  const yAcq = (v: number) => PAD_T + innerH - (innerH * v) / acqMax;

  const gridSteps = [0, 0.25, 0.5, 0.75, 1];
  const revKey = revenue.map(s => Math.round(s.revenue)).join('|');
  const acqKey = acquisition.map(s => Math.round(s.cumulativeUsers)).join('|');

  const revLine = useMemo(
    () => smoothLine(revenue.map((s, i) => ({ x: xFor(i), y: yRev(s.revenue) }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revKey, revMax],
  );
  const revArea = useMemo(() => {
    const base = PAD_T + innerH;
    const pts = revenue.map((s, i) => ({ x: xFor(i), y: yRev(s.revenue) }));
    return `${smoothLine(pts)} L ${pts[pts.length - 1].x} ${base} L ${pts[0].x} ${base} Z`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revKey, revMax]);
  const acqLine = useMemo(
    () => smoothLine(acquisition.map((s, i) => ({ x: xFor(i), y: yAcq(s.cumulativeUsers) }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [acqKey, acqMax],
  );

  const nothingOn = !showRevenue && !showAcquisition;

  return (
    <div className="proj-chart-wrap">
      <div className="gtm-legend">
        {showRevenue && <span className="gtm-legend-item"><i style={{ background: REVENUE }} /> Revenue</span>}
        {showAcquisition && <span className="gtm-legend-item"><i style={{ background: ACQ }} /> Acquisition (MAU)</span>}
      </div>
      <svg className="proj-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="model-rev-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={REVENUE} stopOpacity="0.45" />
            <stop offset="100%" stopColor={REVENUE} stopOpacity="0.03" />
          </linearGradient>
        </defs>

        {gridSteps.map((t, i) => {
          const y = PAD_T + innerH * (1 - t);
          return (
            <g key={`grid-${i}`}>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#e5e7eb" strokeDasharray="3 4" />
              {showRevenue && (
                <text x={PAD_L - 10} y={y + 4} textAnchor="end" fontSize="11" fill={REVENUE}>
                  {fmtCurrency(revMax * t, { compact: true })}
                </text>
              )}
              {showAcquisition && (
                <text x={W - PAD_R + 10} y={y + 4} textAnchor="start" fontSize="11" fill={ACQ}>
                  {fmtNumber(acqMax * t)}
                </text>
              )}
            </g>
          );
        })}

        {nothingOn && (
          <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="14" fill="#94a3b8">
            Toggle Revenue or Acquisition to plot a line.
          </text>
        )}

        {showRevenue && <path d={revArea} fill="url(#model-rev-grad)" />}
        {showRevenue && <path d={revLine} fill="none" stroke={REVENUE} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
        {showAcquisition && <path d={acqLine} fill="none" stroke={ACQ} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={showRevenue ? '0' : '0'} />}

        {!nothingOn && revenue.map((s, i) => {
          const x = xFor(i);
          const isHover = hoverIdx === i;
          return (
            <g key={`pt-${i}`}>
              {showRevenue && <circle cx={x} cy={yRev(s.revenue)} r={isHover ? 6 : 3.5} fill="#fff" stroke={REVENUE} strokeWidth={isHover ? 3 : 2} style={{ pointerEvents: 'none' }} />}
              {showAcquisition && <circle cx={x} cy={yAcq(acquisition[i].cumulativeUsers)} r={isHover ? 6 : 3.5} fill="#fff" stroke={ACQ} strokeWidth={isHover ? 3 : 2} style={{ pointerEvents: 'none' }} />}
              <rect
                x={x - 28} y={PAD_T} width={56} height={innerH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(prev => (prev === i ? null : prev))}
                style={{ cursor: 'pointer' }}
              />
              <text x={x} y={H - PAD_B + 18} textAnchor="middle" fontSize="10" fill="#6b7280" style={{ fontWeight: isHover ? 700 : 500 }}>
                {monthLabel(i)}
              </text>
            </g>
          );
        })}

        {hoverIdx !== null && !nothingOn && (() => {
          const i = hoverIdx;
          const x = xFor(i);
          const anchorY = showRevenue ? yRev(revenue[i].revenue) : yAcq(acquisition[i].cumulativeUsers);
          const tipX = Math.min(W - PAD_R - TIP_W, Math.max(PAD_L, x - TIP_W / 2));
          const tipY = Math.max(PAD_T, anchorY - TIP_H - 14);
          const rev = pctChange(revenue[i].revenue, i >= 1 ? revenue[i - 1].revenue : undefined);
          const mau = pctChange(acquisition[i].cumulativeUsers, i >= 1 ? acquisition[i - 1].cumulativeUsers : undefined);
          const rows: { label: string; value: string; delta: string; positive: boolean; tone: 'rev' | 'acq' }[] = [];
          if (showRevenue) {
            rows.push({ label: 'Revenue', value: fmtCurrency(revenue[i].revenue), delta: `${rev.text} MoM`, positive: rev.positive, tone: 'rev' });
          }
          if (showAcquisition) {
            rows.push({ label: 'MAU', value: fmtNumber(acquisition[i].cumulativeUsers), delta: `${mau.text} MoM`, positive: mau.positive, tone: 'acq' });
            rows.push({ label: 'DAU', value: fmtNumber(acquisition[i].dau), delta: 'daily', positive: true, tone: 'acq' });
            rows.push({ label: 'New users', value: fmtNumber(acquisition[i].newUsers), delta: `spend ${fmtCurrency(acquisition[i].spend, { compact: true })}`, positive: true, tone: 'acq' });
          }
          return (
            <g>
              <line x1={x} y1={PAD_T} x2={x} y2={PAD_T + innerH} stroke="#94a3b8" strokeDasharray="2 3" style={{ pointerEvents: 'none' }} />
              <foreignObject x={tipX} y={tipY} width={TIP_W} height={TIP_H} style={{ overflow: 'visible', pointerEvents: 'none' }}>
                <div className="proj-tooltip">
                  <div className="proj-tooltip-head">
                    <span className="proj-tooltip-month">{monthLabel(i)}</span>
                  </div>
                  <div className="proj-tooltip-rows">
                    {rows.map(r => (
                      <div key={r.label} className="proj-tooltip-row">
                        <span className="proj-tooltip-row-label">{r.label}</span>
                        <span className="proj-tooltip-row-current">{r.value}</span>
                        <span className={`proj-tooltip-row-delta ${r.tone === 'acq' ? 'gtm-paid' : r.positive ? 'positive' : 'negative'}`}>{r.delta}</span>
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
