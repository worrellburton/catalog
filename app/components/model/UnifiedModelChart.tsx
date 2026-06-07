import { useMemo, useState } from 'react';
import type { MonthBreakdown } from '~/services/projections';
import type { GtmMonth } from '~/services/go-to-market';
import type { CashMonth } from '~/services/model-metrics';
import {
  MONTHS,
  monthLabel,
  fmtCurrency,
  fmtNumber,
  fmtPercent,
  niceCeiling,
} from '~/services/projections';

interface ChartProps {
  revenue: MonthBreakdown[];
  acquisition: GtmMonth[];
  cash: CashMonth[];
  showRevenue: boolean;
  showAcquisition: boolean;
  showEngagement: boolean;
  showCash: boolean;
  showPayout: boolean;
}

const REVENUE = '#10b981'; // green — revenue ($, left axis)
const CASH = '#0f172a';    // near-black — cash balance ($, left axis); distinct from revenue green
const ACQ = '#6366f1';     // indigo — MAU (count, right axis)
const ENGAGE = '#f59e0b';  // amber — sales (count, right axis)
const PAYOUT = '#ec4899';  // rose — creator payout ($, left axis)

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

export default function UnifiedModelChart({ revenue, acquisition, cash, showRevenue, showAcquisition, showEngagement, showCash, showPayout }: ChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const W = 1200, H = 520;
  const PAD_L = 72, PAD_R = 72, PAD_T = 24, PAD_B = 44;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const TIP_W = 248, TIP_H = 286;

  // Left axis ($) is shared by revenue + cash + payout; right axis (count) by MAU + sales.
  const leftMax = niceCeiling(Math.max(
    1,
    showRevenue ? Math.max(...revenue.map(s => s.revenue)) : 0,
    showCash ? Math.max(...cash.map(c => c.cash)) : 0,
    showPayout ? Math.max(...cash.map(c => c.creatorPayout)) : 0,
  ));
  const countMax = niceCeiling(Math.max(
    1,
    showAcquisition ? Math.max(...acquisition.map(s => s.cumulativeUsers)) : 0,
    showEngagement ? Math.max(...revenue.map(s => s.sales)) : 0,
  ));

  const xFor = (i: number) => PAD_L + (innerW * i) / (MONTHS - 1);
  const yLeft = (v: number) => PAD_T + innerH - (innerH * Math.max(0, v)) / leftMax;
  const yCount = (v: number) => PAD_T + innerH - (innerH * v) / countMax;

  const gridSteps = [0, 0.25, 0.5, 0.75, 1];
  const revKey = revenue.map(s => `${Math.round(s.revenue)}/${Math.round(s.sales)}`).join('|');
  const acqKey = acquisition.map(s => Math.round(s.cumulativeUsers)).join('|');
  const cashKey = cash.map(c => Math.round(c.cash)).join('|');
  const payoutKey = cash.map(c => Math.round(c.creatorPayout)).join('|');

  const payoutLine = useMemo(() => smoothLine(cash.map((c, i) => ({ x: xFor(i), y: yLeft(c.creatorPayout) }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [payoutKey, leftMax]);

  const revLine = useMemo(() => smoothLine(revenue.map((s, i) => ({ x: xFor(i), y: yLeft(s.revenue) }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revKey, leftMax]);
  const revArea = useMemo(() => {
    const base = PAD_T + innerH;
    const pts = revenue.map((s, i) => ({ x: xFor(i), y: yLeft(s.revenue) }));
    return `${smoothLine(pts)} L ${pts[pts.length - 1].x} ${base} L ${pts[0].x} ${base} Z`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revKey, leftMax]);
  const cashLine = useMemo(() => smoothLine(cash.map((c, i) => ({ x: xFor(i), y: yLeft(c.cash) }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cashKey, leftMax]);
  const acqLine = useMemo(() => smoothLine(acquisition.map((s, i) => ({ x: xFor(i), y: yCount(s.cumulativeUsers) }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [acqKey, countMax]);
  const engLine = useMemo(() => smoothLine(revenue.map((s, i) => ({ x: xFor(i), y: yCount(s.sales) }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revKey, countMax]);

  const anyLeft = showRevenue || showCash || showPayout;
  const anyCount = showAcquisition || showEngagement;
  const nothingOn = !anyLeft && !anyCount;

  return (
    <div className="proj-chart-wrap">
      <div className="gtm-legend">
        {showRevenue && <span className="gtm-legend-item"><i style={{ background: REVENUE }} /> Revenue</span>}
        {showCash && <span className="gtm-legend-item"><i style={{ background: CASH }} /> Cash</span>}
        {showPayout && <span className="gtm-legend-item"><i style={{ background: PAYOUT }} /> Payout</span>}
        {showEngagement && <span className="gtm-legend-item"><i style={{ background: ENGAGE }} /> Sales</span>}
        {showAcquisition && <span className="gtm-legend-item"><i style={{ background: ACQ }} /> MAU</span>}
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
              {anyLeft && (
                <text x={PAD_L - 10} y={y + 4} textAnchor="end" fontSize="11" fill={showRevenue ? REVENUE : CASH}>
                  {fmtCurrency(leftMax * t, { compact: true })}
                </text>
              )}
              {anyCount && (
                <text x={W - PAD_R + 10} y={y + 4} textAnchor="start" fontSize="11" fill="#94a3b8">
                  {fmtNumber(countMax * t)}
                </text>
              )}
            </g>
          );
        })}

        {nothingOn && (
          <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="14" fill="#94a3b8">
            Toggle a line on to plot it.
          </text>
        )}

        {showRevenue && <path d={revArea} fill="url(#model-rev-grad)" />}
        {showRevenue && <path d={revLine} fill="none" stroke={REVENUE} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
        {showCash && <path d={cashLine} fill="none" stroke={CASH} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="6 4" />}
        {showPayout && <path d={payoutLine} fill="none" stroke={PAYOUT} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
        {showEngagement && <path d={engLine} fill="none" stroke={ENGAGE} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
        {showAcquisition && <path d={acqLine} fill="none" stroke={ACQ} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}

        {!nothingOn && revenue.map((s, i) => {
          const x = xFor(i);
          const isHover = hoverIdx === i;
          return (
            <g key={`pt-${i}`}>
              {showRevenue && <circle cx={x} cy={yLeft(s.revenue)} r={isHover ? 6 : 3.5} fill="#fff" stroke={REVENUE} strokeWidth={isHover ? 3 : 2} style={{ pointerEvents: 'none' }} />}
              {showCash && <circle cx={x} cy={yLeft(cash[i].cash)} r={isHover ? 6 : 3.5} fill="#fff" stroke={CASH} strokeWidth={isHover ? 3 : 2} style={{ pointerEvents: 'none' }} />}
              {showPayout && <circle cx={x} cy={yLeft(cash[i].creatorPayout)} r={isHover ? 6 : 3.5} fill="#fff" stroke={PAYOUT} strokeWidth={isHover ? 3 : 2} style={{ pointerEvents: 'none' }} />}
              {showEngagement && <circle cx={x} cy={yCount(s.sales)} r={isHover ? 6 : 3.5} fill="#fff" stroke={ENGAGE} strokeWidth={isHover ? 3 : 2} style={{ pointerEvents: 'none' }} />}
              {showAcquisition && <circle cx={x} cy={yCount(acquisition[i].cumulativeUsers)} r={isHover ? 6 : 3.5} fill="#fff" stroke={ACQ} strokeWidth={isHover ? 3 : 2} style={{ pointerEvents: 'none' }} />}
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
          const anchorY = showRevenue ? yLeft(revenue[i].revenue)
            : showCash ? yLeft(cash[i].cash)
            : showPayout ? yLeft(cash[i].creatorPayout)
            : showAcquisition ? yCount(acquisition[i].cumulativeUsers)
            : yCount(revenue[i].sales);
          const tipX = Math.min(W - PAD_R - TIP_W, Math.max(PAD_L, x - TIP_W / 2));
          const tipY = Math.max(PAD_T, anchorY - TIP_H - 14);
          const rev = pctChange(revenue[i].revenue, i >= 1 ? revenue[i - 1].revenue : undefined);
          const mau = pctChange(acquisition[i].cumulativeUsers, i >= 1 ? acquisition[i - 1].cumulativeUsers : undefined);
          const rows: { label: string; value: string; delta: string; positive: boolean; tone: 'rev' | 'acq' | 'eng' | 'cash' }[] = [];
          if (showRevenue) rows.push({ label: 'Revenue', value: fmtCurrency(revenue[i].revenue), delta: `${rev.text} MoM`, positive: rev.positive, tone: 'rev' });
          if (showCash) rows.push({ label: 'Cash', value: fmtCurrency(cash[i].cash), delta: `${cash[i].net >= 0 ? '+' : ''}${fmtCurrency(cash[i].net, { compact: true })}`, positive: cash[i].net >= 0, tone: 'cash' });
          if (showPayout) rows.push({ label: 'Creator payout', value: fmtCurrency(cash[i].creatorPayout, { compact: true }), delta: revenue[i].revenue > 0 ? `${Math.round((cash[i].creatorPayout / revenue[i].revenue) * 100)}% of rev` : '—', positive: true, tone: 'eng' });
          rows.push({ label: 'OpEx', value: fmtCurrency(cash[i].opex, { compact: true }), delta: `mktg ${fmtCurrency(cash[i].marketing, { compact: true })}`, positive: false, tone: 'cash' });
          if (showEngagement) rows.push({ label: 'Sales', value: fmtNumber(revenue[i].sales), delta: 'orders', positive: true, tone: 'eng' });
          if (showAcquisition) {
            rows.push({ label: 'MAU', value: fmtNumber(acquisition[i].cumulativeUsers), delta: `${mau.text} MoM`, positive: mau.positive, tone: 'acq' });
            rows.push({ label: 'DAU', value: fmtNumber(acquisition[i].dau), delta: 'daily', positive: true, tone: 'acq' });
            rows.push({ label: 'New users', value: fmtNumber(acquisition[i].newUsers), delta: `spend ${fmtCurrency(acquisition[i].spend, { compact: true })}`, positive: true, tone: 'acq' });
          }
          // Operating margin = operating income (net) ÷ revenue, featured
          // as the headline at the bottom of the tooltip.
          const opMargin = revenue[i].revenue > 0 ? cash[i].net / revenue[i].revenue : 0;
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
                        <span className={`proj-tooltip-row-delta ${r.tone === 'acq' ? 'gtm-paid' : r.tone === 'eng' ? 'gtm-eng' : r.tone === 'cash' ? (r.positive ? 'positive' : 'negative') : r.positive ? 'positive' : 'negative'}`}>{r.delta}</span>
                      </div>
                    ))}
                  </div>
                  <div className="proj-tooltip-feature">
                    <span className="proj-tooltip-feature-label">Operating margin</span>
                    <span className={`proj-tooltip-feature-value ${opMargin >= 0 ? 'positive' : 'negative'}`}>{fmtPercent(opMargin, 0)}</span>
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
