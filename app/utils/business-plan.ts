// Business-plan generator for the admin Model page. Takes the live model
// snapshot (assumptions + projected results) and renders a complete,
// Catalog-branded business plan as a self-contained HTML document that opens
// in a new tab — the reader can save it to PDF from there.
//
// Narrative rules (per founder):
//   - NO exit talk anywhere. The model's `exitArr` field is rendered as
//     "run-rate ARR at month N" — the word "exit" never appears in copy.
//   - Revenue is told as a three-phase roadmap: affiliate first (what the
//     projections are built on), then advertising, then direct brand
//     partnerships. Later phases are explicitly NOT in the numbers.
//   - Editorial magazine design: warm paper, serif display type, a
//     single catalog-red accent, page folios. Cover collage is full color.
//   - Cover: the live product feed as a dimmed collage, the wordmark
//     centered with no other text, "The AI for shopping" at the bottom.
//   - Page order: cover · magazine sheet (centered exec summary, market,
//     customer) · revenue phases + key assumptions · go-to-market ("this is
//     just the beginning" + steps, AI content as the strategic marketing
//     experiment at the bottom) · an "Appendix" divider page · LTV breakdown
//     (assumption-flagged, with creator-cohort LTV) · CAC and conversion
//     sensitivity — the two numbers every decision is held to · aligned
//     incentives closer (Shopnomix: cash per order + equity + exclusivity).

import { CATALOG_LOGO_PATH, CATALOG_LOGO_VIEWBOX } from '~/constants/brand-logo';
import { buildModel } from '~/services/model';
import { niceCeiling, type Assumptions } from '~/services/projections';
import type { GtmAssumptions } from '~/services/go-to-market';
import { supabase } from '~/utils/supabase';
import { withTransform } from '~/utils/supabase-image';

export interface BusinessPlanData {
  generatedAt: string;
  scenario: string;
  horizonMonths: number;
  acquisition: {
    cpa: number;
    organicGrowth: number;       // fraction / mo
    budget: number;
    budgetSplitEarly: number;    // fraction
    budgetSplitLate: number;     // fraction
    newUserRetention: number;    // fraction
    monthlyActiveChurn: number;  // fraction
  };
  engagement: {
    sessionsPerUserPerMonth: number;
    sessionTimeMinutes: number;
    impressionsPerSession: number;
  };
  revenue: {
    productConversion: number;   // fraction (sale / impression)
    avgOrderValue: number;       // $
    affiliateCommission: number; // fraction
  };
  costs: {
    grossMargin: number;         // fraction
    monthlyOpex: number;         // $
    cashRaised: number;          // $
  };
  creatorPayout: number;         // fraction of revenue
  /** Raw model assumptions, so the appendix can re-run the projection with
      CAC / conversion nudged and chart the sensitivity. */
  model: { rev: Assumptions; acq: GtmAssumptions };
  results: {
    exitArr: number;             // run-rate ARR at the end of the horizon
    total16moRevenue: number;
    gmvTotal: number;
    totalSales: number;
    ltv: number;
    ltvCac: number;
    cacPaybackMonths: number;
    blendedCac: number;
    avgMau: number;
    runwayMonths: number | null; // null = never runs out within the horizon
    avgBurn: number;
  };
  /** Product-feed media for the cover/appendix collage (injected at open
   *  time). Videos only — every primary product video is natively 3:4,
   *  which is exactly the founder's spec for these walls. */
  feedImages?: Array<{ video: string; poster: string }>;
}

const usd = (n: number, compact = false): string => {
  if (compact && Math.abs(n) >= 1000) {
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    return `$${Math.round(n / 1000)}K`;
  }
  return `$${Math.round(n).toLocaleString('en-US')}`;
};
const usd2 = (n: number): string => `$${n.toFixed(2)}`;
const num = (n: number): string => Math.round(n).toLocaleString('en-US');
const pct = (frac: number, dp = 0): string => `${(frac * 100).toFixed(dp)}%`;
/** Percent with up to two decimals, trailing zeros trimmed (0.2%, 0.15%). */
const pctTrim = (frac: number): string => `${(frac * 100).toFixed(2).replace(/\.?0+$/, '')}%`;
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Pure ink palette (founder's call: no color accents in the document).
// Kept as TS consts so the SVG charts and the stylesheet stay in lockstep.
const ACCENT = '#141210';
const ACCENT_SOFT = 'rgba(20, 18, 16, 0.06)';

// ── SVG charts (monochrome, print-safe) ─────────────────────────────

interface ChartSeries {
  values: number[];
  /** End-of-line annotation, e.g. "CPA −20% · $8.1M ARR". */
  label: string;
  /** Dashed gray for sensitivity variants; solid black for the base. */
  variant?: boolean;
}

/** Multi-line month chart. Y axis is dollars/mo, X is months 1..N. */
function lineChart(series: ChartSeries[], opts: { width?: number; height?: number; area?: boolean; axisLabel?: string } = {}): string {
  const W = opts.width ?? 720;
  const H = opts.height ?? 200;
  const pad = { l: 46, r: 175, t: opts.axisLabel ? 26 : 10, b: 20 };
  const n = series[0]?.values.length ?? 0;
  if (!n) return '';
  const yMax = niceCeiling(Math.max(...series.flatMap(s => s.values), 1));
  const x = (i: number) => pad.l + (i / (n - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / yMax) * (H - pad.t - pad.b);

  const grid: string[] = [];
  for (let g = 0; g <= 4; g++) {
    const v = (yMax * g) / 4;
    const gy = y(v).toFixed(1);
    grid.push(`<line x1="${pad.l}" y1="${gy}" x2="${W - pad.r}" y2="${gy}" stroke="#e4e4e4" stroke-width="1"/>`);
    grid.push(`<text x="${pad.l - 6}" y="${Number(gy) + 3}" text-anchor="end" class="chart-tick">${usd(v, true)}</text>`);
  }
  const ticks = [1, 4, 8, 12, n].filter((m, i, arr) => arr.indexOf(m) === i && m <= n);
  for (const m of ticks) {
    grid.push(`<text x="${x(m - 1).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="chart-tick">M${m}</text>`);
  }

  // End labels: nudge apart so variants ±20% never overlap the base label.
  const slots = series
    .map((s, i) => ({ i, y: y(s.values[n - 1]) }))
    .sort((a, b) => a.y - b.y);
  for (let k = 1; k < slots.length; k++) {
    if (slots[k].y - slots[k - 1].y < 11) slots[k].y = slots[k - 1].y + 11;
  }
  const labelY = new Map(slots.map(s => [s.i, s.y]));

  const lines = series.map((s, i) => {
    const pts = s.values.map((v, j) => `${x(j).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const stroke = s.variant ? '#9a9a9a' : ACCENT;
    const dash = s.variant ? ' stroke-dasharray="4 3"' : '';
    const areaPath = opts.area && !s.variant
      ? `<polygon points="${pts} ${x(n - 1).toFixed(1)},${y(0).toFixed(1)} ${x(0).toFixed(1)},${y(0).toFixed(1)}" fill="${ACCENT_SOFT}"/>`
      : '';
    const ly = (labelY.get(i) ?? y(s.values[n - 1])) + 3;
    return `${areaPath}
      <polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="${s.variant ? 1.4 : 2.2}"${dash}/>
      <text x="${W - pad.r + 8}" y="${ly.toFixed(1)}" class="chart-label${s.variant ? ' is-variant' : ''}">${esc(s.label)}</text>`;
  }).join('');

  const axis = opts.axisLabel
    ? `<text x="${pad.l}" y="11" class="chart-axis">${esc(opts.axisLabel.toUpperCase())}</text>`
    : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${axis}${grid.join('')}${lines}</svg>`;
}

/** Small bar chart for illustrative creator-cohort LTVs, with a dashed
    reference line at the blended LTV assumption. */
function cohortBarChart(bars: Array<[string, number]>, reference: number): string {
  const W = 380;
  const H = 170;
  const pad = { l: 10, r: 10, t: 18, b: 24 };
  const yMax = niceCeiling(Math.max(...bars.map(b => b[1]), reference));
  const bw = (W - pad.l - pad.r) / bars.length;
  const y = (v: number) => pad.t + (1 - v / yMax) * (H - pad.t - pad.b);

  const rects = bars.map(([label, v], i) => {
    const bx = pad.l + i * bw + bw * 0.18;
    const by = y(v);
    return `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${(H - pad.b - by).toFixed(1)}" fill="#1c1916"/>
      <text x="${(pad.l + i * bw + bw / 2).toFixed(1)}" y="${(by - 5).toFixed(1)}" text-anchor="middle" class="chart-label">${esc(usd(v))}</text>
      <text x="${(pad.l + i * bw + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="chart-tick">${esc(label)}</text>`;
  }).join('');
  const ry = y(reference).toFixed(1);

  return `<svg class="chart chart-bars" viewBox="0 0 ${W} ${H}" role="img">
    ${rects}
    <line x1="${pad.l}" y1="${ry}" x2="${W - pad.r}" y2="${ry}" stroke="#9a9a9a" stroke-width="1.2" stroke-dasharray="4 3"/>
    <text x="${pad.l + 2}" y="${Number(ry) - 5}" text-anchor="start" class="chart-label is-variant">blended LTV assumption</text>
  </svg>`;
}

/** Competitive 2x2: search-first ↔ discovery-first on x, AI bolted on ↔
    AI-native on y. Catalog is the filled mark in the open upper-right. */
function quadrantChart(): string {
  const W = 720;
  const H = 330;
  const pad = { l: 110, r: 110, t: 34, b: 34 };
  const px = (fx: number) => pad.l + fx * (W - pad.l - pad.r);
  const py = (fy: number) => pad.t + fy * (H - pad.t - pad.b);
  const players: Array<{ x: number; y: number; name: string; self?: boolean }> = [
    { x: 0.10, y: 0.74, name: 'Amazon' },
    { x: 0.20, y: 0.16, name: 'ChatGPT shopping' },
    { x: 0.72, y: 0.78, name: 'TikTok Shop' },
    { x: 0.58, y: 0.58, name: 'Pinterest' },
    { x: 0.46, y: 0.86, name: 'LTK / ShopMy' },
    { x: 0.88, y: 0.10, name: 'Catalog', self: true },
  ];
  const dots = players.map(pl => {
    const cx = px(pl.x).toFixed(1);
    const cy = py(pl.y).toFixed(1);
    return pl.self
      ? `<circle cx="${cx}" cy="${cy}" r="7" fill="#141210"/>
         <text x="${cx}" y="${Number(cy) + 22}" text-anchor="middle" class="quad-name quad-name--self">${pl.name}</text>`
      : `<circle cx="${cx}" cy="${cy}" r="5" fill="#fffdf8" stroke="#141210" stroke-width="1.5"/>
         <text x="${cx}" y="${Number(cy) + 19}" text-anchor="middle" class="quad-name">${pl.name}</text>`;
  }).join('');
  const mx = (pad.l + (W - pad.r)) / 2;
  const my = (pad.t + (H - pad.b)) / 2;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Competitive positioning map">
    <rect x="${pad.l}" y="${pad.t}" width="${W - pad.l - pad.r}" height="${H - pad.t - pad.b}" fill="none" stroke="#e4e4e4"/>
    <line x1="${mx}" y1="${pad.t}" x2="${mx}" y2="${H - pad.b}" stroke="#e4e4e4"/>
    <line x1="${pad.l}" y1="${my}" x2="${W - pad.r}" y2="${my}" stroke="#e4e4e4"/>
    <text x="${mx}" y="${pad.t - 12}" text-anchor="middle" class="chart-axis">AI-NATIVE</text>
    <text x="${mx}" y="${H - pad.b + 22}" text-anchor="middle" class="chart-axis">AI BOLTED ON</text>
    <text x="${pad.l - 10}" y="${my + 3}" text-anchor="end" class="chart-axis">SEARCH-FIRST</text>
    <text x="${W - pad.r + 10}" y="${my + 3}" text-anchor="start" class="chart-axis">DISCOVERY-FIRST</text>
    ${dots}
  </svg>`;
}

/** GTM cycle diagram: a HIRE circle feeds a strict three-beat loop
    (strategy → deploy the budget → learn) drawn as a ring of arrows —
    the ring itself is the repeat. Pure ink, print-safe. */
function gtmCycleDiagram(): string {
  const W = 720;
  const H = 240;
  const cx = 470;
  const cy = 120;
  const R = 84;
  const nodeR = 38;
  const pos = (deg: number, r: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };
  // Clockwise arc on the ring between two node angles, trimmed at the
  // node edges so the arrowheads land just outside each circle.
  const arc = (a1: number, a2: number) => {
    const gapDeg = (nodeR / R) * (180 / Math.PI) + 5;
    const p1 = pos(a1 + gapDeg, R);
    const p2 = pos(a2 - gapDeg, R);
    return `M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} A ${R} ${R} 0 0 1 ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  };
  const nodes: Array<{ a: number; l1: string; l2?: string }> = [
    { a: -90, l1: 'STRATEGY' },
    { a: 30, l1: 'DEPLOY', l2: 'THE BUDGET' },
    { a: 150, l1: 'LEARN' },
  ];
  const nodeSvg = nodes.map(n => {
    const c = pos(n.a, R);
    const text = n.l2
      ? `<text x="${c.x.toFixed(1)}" y="${(c.y - 2).toFixed(1)}" text-anchor="middle" class="cycle-node-label">${n.l1}</text>
         <text x="${c.x.toFixed(1)}" y="${(c.y + 9).toFixed(1)}" text-anchor="middle" class="cycle-node-label">${n.l2}</text>`
      : `<text x="${c.x.toFixed(1)}" y="${(c.y + 3).toFixed(1)}" text-anchor="middle" class="cycle-node-label">${n.l1}</text>`;
    return `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${nodeR}" fill="#fffdf8" stroke="#141210" stroke-width="1.6"/>${text}`;
  }).join('');
  const arcs = [arc(-90, 30), arc(30, 150), arc(150, 270)]
    .map(d => `<path d="${d}" fill="none" stroke="#141210" stroke-width="1.6" marker-end="url(#cycle-arr)"/>`)
    .join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Hire feeds the strategy, deploy, learn cycle">
    <defs><marker id="cycle-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#141210"/></marker></defs>
    <circle cx="96" cy="${cy}" r="46" fill="#141210"/>
    <text x="96" y="${cy + 4}" text-anchor="middle" class="cycle-hire-label">HIRE</text>
    <text x="96" y="${cy + 64}" text-anchor="middle" class="cycle-sub">MONTH-TO-MONTH ·</text>
    <text x="96" y="${cy + 76}" text-anchor="middle" class="cycle-sub">FULL-TIME PROMISE</text>
    <line x1="146" y1="${cy}" x2="${cx - R - 8}" y2="${cy}" stroke="#141210" stroke-width="1.6" marker-end="url(#cycle-arr)"/>
    ${arcs}
    ${nodeSvg}
    <text x="${cx}" y="${cy - 2}" text-anchor="middle" class="cycle-node-label">REPEAT</text>
    <text x="${cx}" y="${cy + 10}" text-anchor="middle" class="cycle-sub">EVERY CYCLE</text>
  </svg>`;
}

/** Build the full business-plan HTML document string. */
export function buildBusinessPlanHtml(d: BusinessPlanData): string {
  const r = d.results;
  const a = d.acquisition;
  const e = d.engagement;
  const rev = d.revenue;
  const c = d.costs;

  // ── LTV breakdown (mirrors investorMetrics: ARPU × margin × lifetime) ──
  const impsPerUser = e.sessionsPerUserPerMonth * e.impressionsPerSession;
  const ordersPerUser = impsPerUser * rev.productConversion;
  const gmvPerUser = ordersPerUser * rev.avgOrderValue;
  const arpu = gmvPerUser * rev.affiliateCommission;
  const contribPerUser = arpu * c.grossMargin;
  const lifetimeMonths = a.monthlyActiveChurn > 0 ? Math.min(60, 1 / a.monthlyActiveChurn) : 60;

  // ── Appendix series: base plan + CAC / conversion moved one real step ──
  // Concrete dollar/point values on the lines (founder's call), not ±%:
  // CPA one dollar each way, conversion one tenth of a point each way.
  const { rev: mRev, acq: mAcq } = d.model;
  const revSeries = (rv: Assumptions, aq: GtmAssumptions) => buildModel(rv, aq, true).revenue.map(m => m.revenue);
  const arrOf = (vals: number[]) => usd((vals[vals.length - 1] ?? 0) * 12, true);
  const cpaLoVal = Math.max(0.5, mAcq.cpa - 1);
  const cpaHiVal = mAcq.cpa + 1;
  const convLoVal = Math.max(0.0005, mRev.productConversion - 0.001);
  const convHiVal = mRev.productConversion + 0.001;
  const base = revSeries(mRev, mAcq);
  const spendSeries = buildModel(mRev, mAcq, true).acquisition.map(m => m.spend);
  // Cumulative commission stream for the aligned-incentives closer: the
  // receivables that cross the investor's rails, against their cheque.
  const cumCommission: number[] = [];
  {
    let acc = 0;
    for (const v of base) { acc += v; cumCommission.push(acc); }
  }
  const investCrossIdx = cumCommission.findIndex(v => v >= c.cashRaised);
  const receivablesChart = lineChart([
    { values: base.map(() => c.cashRaised), label: `Your investment · ${usd(c.cashRaised, true)}`, variant: true },
    { values: cumCommission, label: `Cumulative · ${usd(r.total16moRevenue, true)}` },
  ], { height: 170, axisLabel: 'Commission routed through your rails, cumulative' });
  const rampChart = lineChart(
    [{ values: spendSeries, label: `${usd(spendSeries[spendSeries.length - 1] ?? 0, true)} / mo by M${d.horizonMonths}` }],
    { height: 150, area: true, axisLabel: 'Monthly ad spend' },
  );
  const cpaLo = revSeries(mRev, { ...mAcq, cpa: cpaLoVal });
  const cpaHi = revSeries(mRev, { ...mAcq, cpa: cpaHiVal });
  const convLo = revSeries({ ...mRev, productConversion: convLoVal }, mAcq);
  const convHi = revSeries({ ...mRev, productConversion: convHiVal }, mAcq);

  const cacChart = lineChart([
    { values: cpaLo, label: `CPA ${usd(cpaLoVal)} · ${arrOf(cpaLo)} ARR`, variant: true },
    { values: base, label: `CPA ${usd(mAcq.cpa)} (base) · ${arrOf(base)} ARR` },
    { values: cpaHi, label: `CPA ${usd(cpaHiVal)} · ${arrOf(cpaHi)} ARR`, variant: true },
  ], { height: 148, axisLabel: 'Monthly commission revenue' });
  const convChart = lineChart([
    { values: convHi, label: `Conv ${pctTrim(convHiVal)} · ${arrOf(convHi)} ARR`, variant: true },
    { values: base, label: `Conv ${pctTrim(mRev.productConversion)} (base) · ${arrOf(base)} ARR` },
    { values: convLo, label: `Conv ${pctTrim(convLoVal)} · ${arrOf(convLo)} ARR`, variant: true },
  ], { height: 148, axisLabel: 'Monthly commission revenue' });

  // Cover collage: pack the page with as many product tiles as the feed
  // can fill — grid density scales with how many images came back, and
  // the wall cycles if there are fewer images than cells so the page is
  // always fully covered.
  const feed = d.feedImages ?? [];
  // ~3:4 cells showing the FULL primary image (contain on a white card,
  // never zoomed/cropped). Equal cols and rows on a portrait page give
  // cells within a few percent of the primaries' own 3:4, and fractional
  // rows always land flush on the page edge — no bands, no strips.
  const coverCols = feed.length >= 64 ? 8 : feed.length >= 36 ? 6 : 4;
  const coverTiles = feed.length
    ? Array.from({ length: coverCols * 12 }, (_, i) => {
        const m = feed[i % feed.length];
        // Poster-first: a real <img> paints the moment its (320px webp)
        // bytes land; the video sits ON TOP with no src — a script after
        // load attaches sources a few at a time so a hundred videos never
        // starve the posters on a phone connection.
        return `<span class="cover-tile${i >= coverCols * coverCols ? ' cover-extra' : ''}">`
          + (m.poster ? `<img src="${esc(m.poster)}" alt="" decoding="async" />` : '')
          + `<video data-src="${esc(m.video)}" poster="${esc(m.poster)}" muted loop playsinline preload="none"></video>`
          + `</span>`;
      }).join('')
    : '';
  const coverGridStyle = `grid-template-columns: repeat(${coverCols}, minmax(0, 1fr)); grid-template-rows: repeat(${coverCols}, minmax(0, 1fr)); --cover-cols: ${coverCols};`;


  // Assumption rows kept to the load-bearing ten so the table fits the
  // one-page budget: label, value, the benchmark/why.
  const assumptions: Array<[string, string, string]> = [
    ['Total advertising spend', usd(a.budget), `All paid marketing across the ${d.horizonMonths} months.`],
    ['Blended CPA (paid)', usd(a.cpa), 'What one new user costs us in ad spend.'],
    ['Organic growth', `${pct(a.organicGrowth)} / mo`, 'Users who join from word of mouth each month, as a share of the existing base.'],
    ['New-user retention (M1)', pct(a.newUserRetention), 'Share of new users still active in their first full month (M1 = month one after signup).'],
    ['Monthly active churn', pct(a.monthlyActiveChurn), 'Share of the active base we lose each month.'],
    ['Sessions / user / mo', num(e.sessionsPerUserPerMonth), 'How often the average user opens Catalog in a month.'],
    ['Product conversion', pct(rev.productConversion, 2), 'Share of product impressions that turn into a purchase.'],
    ['Average order value', usd(rev.avgOrderValue), 'What a typical order is worth.'],
    ['Affiliate commission', pct(rev.affiliateCommission), 'Our cut of every sale we send to a merchant.'],
    ['Monthly OpEx (avg)', usd(c.monthlyOpex), `Average monthly operating cost, including the ${pct(d.creatorPayout)} creator payout.`],
  ];

  const assumptionRow = ([label, value, why]: [string, string, string]) => `
    <tr>
      <td class="a-label">${esc(label)}</td>
      <td class="a-value">${esc(value)}</td>
      <td class="a-why">${esc(why)}</td>
    </tr>`;

  // LTV calculation chain — each row is one factor and the running result.
  const ltvSteps: Array<[string, string, string, string]> = [
    ['', 'Sessions / user / month', num(e.sessionsPerUserPerMonth), ''],
    ['×', 'Product impressions / session', num(e.impressionsPerSession), `${num(impsPerUser)} impressions / user / mo`],
    ['×', 'Product conversion', pct(rev.productConversion, 2), `${ordersPerUser.toFixed(2)} orders / user / mo`],
    ['×', 'Average order value', usd(rev.avgOrderValue), `${usd2(gmvPerUser)} GMV / user / mo`],
    ['×', 'Affiliate commission', pct(rev.affiliateCommission), `${usd2(arpu)} revenue / user / mo`],
    ['×', 'Gross margin', pct(c.grossMargin), `${usd2(contribPerUser)} contribution / user / mo`],
    ['×', 'Expected lifetime (1 ÷ monthly churn)', `${Math.round(lifetimeMonths)} months`, `${usd(r.ltv)} LTV*`],
  ];
  const ltvRow = ([op, label, value, runningResult]: [string, string, string, string]) => `
    <tr>
      <td class="l-op">${op}</td>
      <td class="l-label">${esc(label)}</td>
      <td class="l-value">${esc(value)}</td>
      <td class="l-run">${esc(runningResult)}</td>
    </tr>`;

  // Creator-cohort LTV chart: illustrative cohorts around the blended
  // assumption, until real attributed orders replace them.
  const cohortChart = cohortBarChart(
    [['Creator A', r.ltv * 0.6], ['Creator B', r.ltv * 1.0], ['Creator C', r.ltv * 1.45]],
    r.ltv,
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<!-- Fixed-width viewport: the document is a composed PDF page, not a
     responsive site. Phones render the full 920px composition scaled to
     fit and pinch-zoom into it — same integrity as the printed sheet. -->
<meta name="viewport" content="width=920, user-scalable=yes" />
<title>Catalog Business Plan</title>
<style>
  :root { --ink:#141210; --muted:#7a746c; --line:#e7e2da; --paper:#fffdf8; --accent:${ACCENT}; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #efece6; color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
    font-size: 13px; line-height: 1.6; -webkit-font-smoothing: antialiased; }
  .serif, h2, h3, .display, .pullquote, .step-no, .stat-value, .feature-item h4 {
    font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif; }
  .page { position: relative; max-width: 860px; margin: 18px auto; padding: 44px 64px 56px;
    background: var(--paper); box-shadow: 0 2px 24px rgba(20,18,16,0.07); }
  .toolbar { position: sticky; top: 0; z-index: 2; display: flex; justify-content: flex-end; gap: 8px;
    padding: 12px 16px; background: rgba(239,236,230,0.92); backdrop-filter: blur(8px); }
  .toolbar button { font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
    border: 1px solid var(--line); background: #fff; color: var(--ink); border-radius: 8px; padding: 8px 14px; }
  .toolbar button.primary { background: var(--ink); color: #fff; border-color: var(--ink); }

  /* Print: cover + one sheet per .page; nothing splits across pages. */
  @media print {
    /* Zero @page margins do two jobs at once: the browser's injected
       header/footer (date, title, "about:blank", page N/M) only renders
       inside the margin band, so it vanishes; and 100vh becomes exactly
       one sheet, so a full-height page can't spill a few pixels onto a
       ghost sheet (the blank pages 5–6 were 100vh boxes whose PADDING
       sat outside the box, overflowing every sheet by ~50px). */
    @page { size: auto; margin: 0; }
    html, body { margin: 0; }
    .toolbar { display: none; }
    /* The whole printed sheet is paper-colored — without this the page
       background only covered the content box, leaving the rest of the
       sheet white (a two-tone page). */
    body { background: var(--paper); font-size: 9px; line-height: 1.5;
      -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { padding: 26px 34px; max-width: none; margin: 0; box-shadow: none;
      background: var(--paper); }
    /* border-box so min-height:100vh INCLUDES the padding — sheet-exact. */
    .page, .cover-page, .appendix-cover { box-sizing: border-box; }
    .cover-page { min-height: 100vh; page-break-after: always; }
    /* A hair under the sheet so sub-pixel rounding can't overflow; and
       break-inside stays AUTO — an over-tall page flows onto the next
       sheet instead of leaving a folio-only ghost page behind it. */
    .page { min-height: calc(100vh - 2px); page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    section { page-break-inside: avoid; break-inside: avoid; margin-bottom: 18px; }
    .statband, .phases, .lens-grid, .lens, .feature-band, .chart, .flow,
    .features, .solutions, table.ltv-chain { page-break-inside: avoid; break-inside: avoid; }
    .solutions { page-break-inside: avoid; break-inside: avoid; margin-top: 20px; }
    .solution p { font-size: 9.5px; }
    .folio { margin-bottom: 18px; }
    .divider { min-height: 82vh; }
    .cover-feed .cover-extra { display: none; }
    .kicker { margin-bottom: 3px; }
    h2 { font-size: 15px; margin-bottom: 6px; }
    .display { font-size: 21px; }
    p { margin-bottom: 7px; }
    table.assumptions { font-size: 9px; }
    table.assumptions td { padding: 5px 8px; }
    table.ltv-chain td { padding: 4px 8px; }
    .phase { padding: 11px 13px; }
    .phase h4 { font-size: 11px; }
    .phase p { font-size: 9px; line-height: 1.45; }
    .statband { padding: 12px 0; }
    .footer { margin-top: 14px; padding-top: 8px; }
  }

  /* ── Cover: the product feed, full color, behind the wordmark. ── */
  .cover-page { position: relative; overflow: hidden; background: #000; color: #fff; min-height: 100vh;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 26px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* Columns arrive inline (density scales with image count). Every tile
     is a fixed 3:4 card, cover-filled by its product image — uniform wall,
     no letterbox strips. Rows overflow the page and crop at the edge. */
  .cover-feed { position: absolute; inset: 0; display: grid; gap: 5px; padding: 5px; background: #000; }
  /* Screen: literal 3:4 frames regardless of viewport shape (the inline
     stretch rows are a print concern); extra rows render and the page
     center-crops them. Print keeps the flush stretch grid and hides the
     extras so the page edge stays clean. */
  @media screen {
    .cover-feed {
      grid-template-rows: none !important;
      grid-auto-rows: calc((100vw - (var(--cover-cols, 8) + 1) * 5px) / var(--cover-cols, 8) * 4 / 3);
      align-content: center;
    }
  }
  /* contain, not cover: the full, un-zoomed product picture on a white
     card. Print cells are ~3:4 (the primaries' own shape), so the fit is
     near-exact there; any sliver is white-on-white and invisible. */
  .cover-tile { position: relative; overflow: hidden; min-width: 0; min-height: 0; background: #fff; }
  /* img underneath paints first; the video layers over it once its bytes
     arrive (transparent until then, so the poster img shows through). */
  .cover-feed img, .cover-feed video { position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: contain; box-sizing: border-box; display: block; }
  .cover-feed img { background: #fff; }
  .cover-scrim { position: absolute; inset: 0;
    background: linear-gradient(rgba(0,0,0,0.82), rgba(0,0,0,0.92)); }
  .appendix-cover { position: relative; overflow: hidden; background: #000; min-height: 100vh; }
  .appendix-cover .divider { position: relative; z-index: 1; }
  .appendix-cover .divider h2 { color: #fff; }
  .cover-logo { position: relative; z-index: 1; width: clamp(240px, 38vw, 400px); height: auto; display: block;
    filter: drop-shadow(0 4px 28px rgba(0,0,0,0.55)); }
  .cover-tagline { position: relative; z-index: 1; margin: 0;
    font-size: 15px; font-weight: 500; letter-spacing: 0.24em; text-transform: uppercase;
    color: rgba(255,255,255,0.95); text-shadow: 0 2px 14px rgba(0,0,0,0.6); }
  .cover-for { position: relative; z-index: 1; margin: 10px 0 0;
    font-size: 10.5px; font-weight: 700; letter-spacing: 0.3em; text-transform: uppercase;
    color: rgba(255,255,255,0.62); text-shadow: 0 2px 14px rgba(0,0,0,0.6); }

  /* ── Page furniture: running head + page number, like a magazine folio. ── */
  .folio { display: flex; align-items: center; gap: 14px; font-size: 9.5px; font-weight: 700;
    letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted);
    border-bottom: 1.5px solid var(--ink); padding-bottom: 9px; margin-bottom: 30px; }
  .folio-logo { height: 14px; width: auto; display: block; }
  .folio-no { margin-left: auto; color: var(--ink); font-variant-numeric: tabular-nums; }

  section { margin: 0 0 30px; }
  .kicker { font-size: 9.5px; font-weight: 800; letter-spacing: 0.2em; text-transform: uppercase;
    color: var(--accent); margin: 0 0 7px; }
  .kicker::after { content: ''; display: block; width: 34px; border-top: 2px solid var(--accent); margin-top: 6px; }
  h2 { font-size: 20px; font-weight: 700; letter-spacing: -0.012em; line-height: 1.18; margin: 0 0 8px; }
  h3 { font-size: 13px; font-weight: 700; margin: 12px 0 4px; }
  p { margin: 0 0 10px; color: #3a352f; line-height: 1.62; }
  .standfirst { font-size: 14px; line-height: 1.55; color: #57514a; max-width: 62ch; }
  .display { font-weight: 700; font-size: 28px; line-height: 1.14; letter-spacing: -0.015em; }

  /* ── Magazine sheet ── */
  .exec { text-align: center; margin-bottom: 40px; }
  .mag-row { margin-bottom: 14px; }
  .exec .kicker::after { margin-inline: auto; }
  .exec p { max-width: 58ch; margin-inline: auto; }
  .statband { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px;
    border-top: 3px solid var(--ink); border-bottom: 1px solid var(--ink);
    padding: 16px 0 14px; margin: 20px 0 6px; }
  .stat-value { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
  .stat-label { font-size: 9px; font-weight: 700; letter-spacing: 0.13em; text-transform: uppercase; color: var(--muted); margin-top: 3px; }
  .mag-row { display: grid; grid-template-columns: 5fr 7fr; gap: 30px; align-items: start; margin-top: 8px; }
  .mag-row.flip { grid-template-columns: 7fr 5fr; }
  .pullquote { font-size: 21px; line-height: 1.25; font-weight: 700; letter-spacing: -0.01em;
    border-left: 3px solid var(--ink); padding-left: 18px; margin: 4px 0; }
  .mag-row .dropcap { text-align: justify; hyphens: auto; -webkit-hyphens: auto; }
  .mag-row > :last-child:not(.features) { border-left: 1px solid var(--line); padding-left: 28px; }
  .dropcap::first-letter { font-family: 'Iowan Old Style', Palatino, Georgia, serif; font-size: 36px; font-weight: 700;
    float: left; line-height: 0.82; padding: 4px 8px 0 0; color: var(--ink); }
  .features { display: grid; gap: 14px; border-left: 1.5px solid var(--ink); padding-left: 18px; }
  .solutions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 26px; margin-top: 30px; }
  .solution { border-top: 2px solid var(--ink); padding-top: 9px; }
  .solution span { display: block; font-size: 9px; font-weight: 800; letter-spacing: 0.16em;
    text-transform: uppercase; color: var(--muted); margin-bottom: 4px; }
  .solution p { margin: 0; font-size: 11px; line-height: 1.55; color: #3a352f; }
  .feature-item h4 { margin: 0 0 3px; font-size: 13.5px; font-weight: 700; letter-spacing: -0.01em; }
  .feature-item p { margin: 0; font-size: 10.5px; line-height: 1.55; color: var(--muted); }

  table.assumptions { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 4px; }
  table.assumptions th { text-align: left; font-size: 9.5px; letter-spacing: 0.1em; text-transform: uppercase;
    color: var(--muted); padding: 5px 10px; border-bottom: 2px solid var(--ink); }
  table.assumptions td { padding: 7px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  .a-label { font-weight: 600; color: var(--ink); width: 36%; }
  .a-value { font-weight: 700; width: 22%; font-variant-numeric: tabular-nums; }
  .a-why { color: var(--muted); }

  /* Revenue roadmap cards. */
  .phases { display: grid; grid-template-columns: repeat(3, 1fr); gap: 26px; margin: 12px 0 14px; }
  .phase { border-top: 2px solid var(--ink); padding: 11px 0 0; }
  .phase.now { border-top: 5px solid var(--ink); }
  .phase-stage { font-size: 9px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
  .phase-stage .tag { display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 999px;
    background: var(--ink); color: #fff; font-size: 8.5px; letter-spacing: 0.06em; vertical-align: 1px; }
  .phase h4 { margin: 5px 0 4px; font-size: 12.5px; letter-spacing: -0.01em; }
  .phase p { margin: 0; font-size: 10.5px; color: var(--muted); line-height: 1.55; }
  .phase-note { font-size: 10px; color: var(--muted); font-style: italic; }

  /* GTM: AI banner + vertical numbered steps. */
  .ai-banner { background: var(--ink); color: #fff; border-radius: 14px; padding: 17px 20px; margin: 14px 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .ai-banner .kicker { color: #fff; }
  .ai-banner .kicker::after { border-color: #fff; }
  .ai-banner p { color: rgba(255,255,255,0.9); margin: 0; font-size: 11px; }
  .solutions--two { grid-template-columns: 1fr 1fr; }
  .cycle-hire-label { font-size: 13px; font-weight: 800; letter-spacing: 0.14em; fill: #fff; font-family: inherit; }
  .cycle-node-label { font-size: 9.5px; font-weight: 800; letter-spacing: 0.1em; fill: var(--ink); font-family: inherit; }
  .cycle-sub { font-size: 8px; font-weight: 700; letter-spacing: 0.12em; fill: var(--muted); font-family: inherit; }
  .quad-name { font-size: 10px; font-weight: 600; fill: #57514a; font-family: inherit; }
  .quad-name--self { font-weight: 800; fill: var(--ink); font-size: 11px; }

  /* LTV chain. */
  table.ltv-chain { width: 100%; border-collapse: collapse; font-size: 11px; margin: 6px 0 10px; }
  table.ltv-chain td { padding: 7px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  .l-op { width: 22px; font-weight: 800; color: var(--muted); }
  .l-label { font-weight: 600; }
  .l-value { font-weight: 700; width: 18%; font-variant-numeric: tabular-nums; }
  .l-run { color: var(--muted); width: 36%; text-align: right; font-variant-numeric: tabular-nums; }
  table.ltv-chain tr:last-child td { border-bottom: 2px solid var(--ink); }
  table.ltv-chain tr:last-child .l-run { color: var(--ink); font-weight: 800; font-size: 12px; }
  .footnote { font-size: 9.5px; color: var(--muted); font-style: italic; }
  .endmark { display: inline-block; width: 7px; height: 7px; background: var(--ink); margin-left: 6px; vertical-align: baseline; }
  .ltv-vs { display: flex; gap: 22px; align-items: baseline; margin: 10px 0 4px; }
  .ltv-vs b { font-size: 15px; font-family: 'Iowan Old Style', Palatino, Georgia, serif; }
  .ltv-vs .vs-arrow { color: var(--ink); font-weight: 800; }

  /* Creator attribution flow. */
  .flow { display: flex; align-items: stretch; gap: 8px; margin: 12px 0; }
  .flow-step { flex: 1; border-top: 1.5px solid var(--ink); padding: 8px 0 0;
    font-size: 10px; color: #45403a; }
  .flow-step b { display: block; font-size: 10.5px; letter-spacing: 0.07em; text-transform: uppercase; margin-bottom: 2px; }
  .flow-arrow { align-self: center; font-weight: 800; color: var(--muted); }
  .cohort-grid { display: grid; grid-template-columns: 7fr 5fr; gap: 22px; align-items: center; }

  /* Charts. */
  .chart { width: 100%; height: auto; display: block; margin: 6px 0 4px; }
  .chart-tick { font-size: 9px; fill: var(--muted); font-family: inherit; }
  .chart-axis { font-size: 8.5px; font-weight: 700; letter-spacing: 0.14em; fill: var(--muted); font-family: inherit; }
  .chart-label { font-size: 9.5px; font-weight: 700; fill: var(--ink); font-family: inherit; }
  .chart-label.is-variant { font-weight: 500; fill: var(--muted); }
  .chart-caption { font-size: 9.5px; color: var(--muted); margin: 0 0 12px; }
  .lens-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; margin-top: 14px; }
  .lens { border-top: 2px solid var(--ink); padding: 10px 0 0; }
  .lens h4 { margin: 0 0 4px; font-size: 11.5px; }
  .lens h4::before { content: ''; display: inline-block; width: 7px; height: 7px; background: var(--ink);
    border-radius: 2px; margin-right: 7px; vertical-align: 1px; }
  .lens p { margin: 0; font-size: 10.5px; color: var(--muted); }
  .feature-band { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 8px 0 14px; }
  .feature { border-top: 3px solid var(--ink); padding: 10px 0 0; }
  .feature .stat-value { font-size: 22px; }

  .divider { min-height: 70vh; display: flex; align-items: center; justify-content: center; text-align: center; }
  .divider .display { font-size: 40px; letter-spacing: 0.01em; }
  .divider .display::before { content: ''; display: block; width: 40px; border-top: 2.5px solid var(--ink); margin: 0 auto 20px; }
  .footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid var(--line); font-size: 9.5px; color: var(--muted); }
  .footer b { color: var(--ink); }
  .disclaimer { font-size: 9.5px; color: var(--muted); font-style: italic; }
</style>
</head>
<body>
  <div class="toolbar">
    <button class="primary" onclick="window.print()">Save as PDF</button>
  </div>

  <!-- Cover — the product feed behind the wordmark. No other copy. -->
  <div class="cover-page">
    ${coverTiles ? `<div class="cover-feed" style="${coverGridStyle}">${coverTiles}</div>` : ''}
    <div class="cover-scrim"></div>
    <svg class="cover-logo" viewBox="${CATALOG_LOGO_VIEWBOX}" role="img" aria-label="Catalog"><path fill="#ffffff" d="${CATALOG_LOGO_PATH}" /></svg>
    <p class="cover-tagline">The AI for shopping</p>
    <p class="cover-for">Prepared for Shopnomix</p>
  </div>

  <!-- Sheet 1 — magazine: centered summary, market, customer. -->
  <div class="page">
    <div class="folio"><svg class="folio-logo" viewBox="${CATALOG_LOGO_VIEWBOX}" role="img" aria-label="Catalog"><path fill="#141210" d="${CATALOG_LOGO_PATH}" /></svg><span>Business Plan</span><span class="folio-no">02</span></div>
    <section class="exec">
      <p class="kicker">Executive summary</p>
      <h2 class="display">AI shopping doesn't have a home yet. We're building it.</h2>
      <p>Catalog is where you discover what to buy next: a daily feed of shoppable looks made by creators and indexed by AI, across every brand at once. Creators publish their taste, AI makes it searchable, and every product in every look is one tap from checkout. Discovery stops being something that interrupts you on a social app and becomes the product itself.</p>
      <p>Search answers what you already know you want, and social buries shopping inside entertainment. There is no destination built for AI-native shopping; Catalog is built to be it. Revenue starts with affiliate commission on every sale we drive (the model these projections are built on); advertising and direct brand partnerships follow on the same rails, upside on top of every figure in this plan.</p>
    </section>

    <section>
      <p class="kicker">01 · Market &amp; opportunity</p>
      <div class="mag-row">
        <div class="pullquote">Human taste, indexed by AI.</div>
        <p class="dropcap">Social platforms proved that shoppable video converts, but they bury it inside content people came to see for other reasons: entertainment first, shopping as an interruption. Catalog is the destination built for it: a shopping-first daily feed across every brand, with attribution and unit economics designed in from day one. We monetize the purchase intent that social platforms create but don't own.</p>
      </div>
    </section>

    <section>
      <p class="kicker">02 · Target customer</p>
      <div class="mag-row flip">
        <p class="dropcap">Our core customer is the everyday consumer who already discovers products by scrolling: the person who screenshots outfits, saves links, and asks "where's that from?" They are mobile-first, visually driven, and shop across categories: apparel, beauty, home, lifestyle. Think the audience of Amazon, Pinterest, and TikTok Shop, not a fashion-only niche. Their taste is scattered across screenshots and tabs; we give them one feed, every brand, tuned to the individual. A personal storefront that gets sharper with every tap, save, and shop.</p>
        <div class="features">
          <div class="feature-item">
            <h4>Your daily feed</h4>
            <p>A feed that learns your taste. Every scroll, save, and shop tunes tomorrow's looks to you, across every brand at once.</p>
          </div>
          <div class="feature-item">
            <h4>Shop through creators</h4>
            <p>Creators publish shoppable looks with every product tagged in place. See it styled on a person, tap it, own it.</p>
          </div>
          <div class="feature-item">
            <h4>Create a catalog for anything</h4>
            <p>Type any idea and AI assembles a shoppable catalog around it: products, looks, and try-ons for exactly that.</p>
          </div>
        </div>
      </div>
    </section>
    <div class="solutions">
      <div class="solution">
        <span>For shoppers</span>
        <p>The most elegant way to discover products: one feed, every brand, already tuned to your taste.</p>
      </div>
      <div class="solution">
        <span>For creators</span>
        <p>The easiest way to earn on retail content: publish a look, every product tagged, paid on the sales it drives.</p>
      </div>
      <div class="solution">
        <span>For brands</span>
        <p>Full transparency on the numbers: attribution to the order, analytics per look, per creator, per product.</p>
      </div>
    </div>
  </div>

  <!-- Sheet 2 — revenue phases + the key assumptions, one page. -->
  <div class="page">
    <div class="folio"><svg class="folio-logo" viewBox="${CATALOG_LOGO_VIEWBOX}" role="img" aria-label="Catalog"><path fill="#141210" d="${CATALOG_LOGO_PATH}" /></svg><span>Business Plan</span><span class="folio-no">03</span></div>
    <section>
      <p class="kicker">03 · Revenue model</p>
      <h2>Three revenue lines, unlocked in sequence.</h2>
      <div class="phases">
        <div class="phase now">
          <div class="phase-stage">Phase 1 <span class="tag">Now</span></div>
          <h4>Affiliate commission</h4>
          <p>We earn ${pct(rev.affiliateCommission)} on every sale we drive, via affiliate networks and merchants' own programs. No inventory, revenue from the first order, and every conversion builds the attribution dataset the next phases are sold on.</p>
        </div>
        <div class="phase">
          <div class="phase-stage">Phase 2</div>
          <h4>Advertising</h4>
          <p>Sponsored looks and promoted placements, native to the feed. Because we attribute to the order, brands buy measurable ROAS instead of impressions: performance budgets at margins above affiliate take rates.</p>
        </div>
        <div class="phase">
          <div class="phase-stage">Phase 3</div>
          <h4>Direct brand partnerships</h4>
          <p>Negotiated take rates above affiliate baselines, exclusive drops, co-created creator campaigns, and managed storefronts on the partner platform we've already built. The deepest margins and the strongest moat.</p>
        </div>
      </div>
      <p class="phase-note">The financials in this plan are built on Phase 1 economics only. Advertising and direct-partnership revenue are upside on top of every figure in this document.</p>
      <div class="statband">
        <div><div class="stat-value">${usd(r.total16moRevenue)}</div><div class="stat-label">${d.horizonMonths}-mo commission revenue</div></div>
        <div><div class="stat-value">${usd(r.gmvTotal, true)}</div><div class="stat-label">GMV · ${num(r.totalSales)} orders</div></div>
        <div><div class="stat-value">${usd(r.exitArr)}</div><div class="stat-label">Run-rate ARR at month ${d.horizonMonths}</div></div>
        <div><div class="stat-value">${r.ltvCac.toFixed(1)}×</div><div class="stat-label">LTV : CAC</div></div>
      </div>
    </section>

    <section>
      <p class="kicker">04 · Key assumptions</p>
      <h2>The ten numbers the plan runs on (${esc(d.scenario)} case, ${d.horizonMonths} months).</h2>
      <table class="assumptions">
        <thead><tr><th>Assumption</th><th>Value</th><th>Detail</th></tr></thead>
        <tbody>
          ${assumptions.map(assumptionRow).join('')}
        </tbody>
      </table>
      <p class="disclaimer" style="margin-top:8px">Model projections from the assumptions above, not guarantees. Affiliate (Phase 1) revenue only.</p>
    </section>
  </div>

  <!-- Sheet 3 — go-to-market I: the whole machine, ramped with product
       readiness. Channel grid + the model's real spend ramp + sequence. -->
  <div class="page">
    <div class="folio"><svg class="folio-logo" viewBox="${CATALOG_LOGO_VIEWBOX}" role="img" aria-label="Catalog"><path fill="#141210" d="${CATALOG_LOGO_PATH}" /></svg><span>Business Plan</span><span class="folio-no">04</span></div>
    <section>
      <p class="kicker">05 · Go-to-market</p>
      <h2>Every channel, when the product is ready.</h2>
      <p class="standfirst">The full machine runs every channel and, once tuned, runs without hand-holding. But channels only compound on a product that works: users, stickiness, effectiveness. So the budget ramps with product readiness, and the big influencer budgets come last, once the machine deserves them.</p>
      <div class="solutions">
        <div class="solution">
          <span>SEO</span>
          <p>Every look, product, and catalog page indexed and ranking.</p>
        </div>
        <div class="solution">
          <span>Paid ads</span>
          <p>Performance campaigns on Meta, TikTok, and Google.</p>
        </div>
        <div class="solution">
          <span>Social on cadence</span>
          <p>Organic posting, native to each platform, on a fixed schedule.</p>
        </div>
        <div class="solution">
          <span>Creators</span>
          <p>The primary channel: paid on signups and ongoing engagement.</p>
        </div>
        <div class="solution">
          <span>Lifecycle</span>
          <p>Email, SMS, and push, built around the daily feed drop.</p>
        </div>
        <div class="solution">
          <span>Measurement</span>
          <p>Attribution ties every channel back to CAC, automatically.</p>
        </div>
      </div>
    </section>

    <section>
      <h3>The ramp: spend follows readiness</h3>
      ${rampChart}
      <p class="chart-caption">${pct(a.budgetSplitEarly)} of the ${usd(a.budget)} budget deploys early while the product sharpens; ${pct(a.budgetSplitLate)} arrives at the tail, when stickiness is proven and the channels are tuned.</p>
    </section>

    <section>
      <div class="flow">
        <div class="flow-step"><b>1 · Sharpen the product</b>Make the feed convert.</div>
        <div class="flow-arrow">→</div>
        <div class="flow-step"><b>2 · Prove stickiness</b>Users return on their own.</div>
        <div class="flow-arrow">→</div>
        <div class="flow-step"><b>3 · Scale the channels</b>The system runs itself.</div>
        <div class="flow-arrow">→</div>
        <div class="flow-step"><b>4 · Big influencers</b>Big budgets, deployed last.</div>
      </div>
    </section>
  </div>

  <!-- Sheet 4 — go-to-market II: creators + AI-driven content, three steps. -->
  <div class="page">
    <div class="folio"><svg class="folio-logo" viewBox="${CATALOG_LOGO_VIEWBOX}" role="img" aria-label="Catalog"><path fill="#141210" d="${CATALOG_LOGO_PATH}" /></svg><span>Business Plan</span><span class="folio-no">05</span></div>
    <section>
      <p class="kicker">05 · Go-to-market, continued</p>
      <h2>This is just the beginning.</h2>
      <p class="standfirst">One small, disciplined, aggressive team running a strict cycle. Marketing moves through creators, our primary channel: they post their link, build catalogs, and are paid on every signup and on that audience's ongoing engagement. Word-of-mouth adds ${pct(a.organicGrowth)} of the base each month on top of paid acquisition at a ~${usd(a.cpa)} blended CPA.</p>
      ${gtmCycleDiagram()}
      <div class="solutions solutions--two">
        <div class="solution">
          <span>The hires</span>
          <p>Three BD and marketing consultants, month-to-month, specialised in creator relations, with a real promise on the table: prove it here and convert to full-time. Hungry and aggressive is the job description.</p>
        </div>
        <div class="solution">
          <span>The CMO</span>
          <p>When the cycle proves itself, a CMO comes in to own it: one accountable operator over the consultants, the CRM, and the channel mix, hired to scale a machine that already works rather than to invent one.</p>
        </div>
        <div class="solution">
          <span>The discipline</span>
          <p>Every contact, campaign, and dollar lives in the CRM. Weekly targets are held to. Nothing deploys without a number attached to it.</p>
        </div>
        <div class="solution">
          <span>The cycle</span>
          <p>Strategy picks the campaigns, the budget deploys strictly against them, the results are read honestly, and the next cycle starts sharper. CPA falls every loop.</p>
        </div>
        <div class="solution">
          <span>The goal</span>
          <p>Sharpen the product until it converts and retains on its own. The big influencer budgets only go in once the machine has earned them.</p>
        </div>
      </div>
      <div class="ai-banner">
        <p class="kicker">Strategic marketing experiment</p>
        <p>Running alongside the core motion: AI-driven content. Users try products on with AI, build catalogs of what they love, and post them. The people we acquire also make the content that acquires the next wave: creation compounds while production cost doesn't.</p>
      </div>
    </section>
  </div>

  <!-- Sheet 4 — appendix divider: the word over the live product wall. -->
  <div class="page appendix-cover">
    <div class="cover-feed" style="${coverGridStyle}">${coverTiles}</div>
    <div class="cover-scrim"></div>
    <div class="divider">
      <h2 class="display">Appendix</h2>
    </div>
  </div>

  <!-- Sheet 5 — LTV: assumption-flagged breakdown + creator cohorts. -->
  <div class="page">
    <div class="folio"><svg class="folio-logo" viewBox="${CATALOG_LOGO_VIEWBOX}" role="img" aria-label="Catalog"><path fill="#141210" d="${CATALOG_LOGO_PATH}" /></svg><span>Business Plan</span><span class="folio-no">07</span></div>
    <section>
      <p class="kicker">Appendix A · Lifetime value*</p>
      <h2>What a user is worth, and how we'll know.</h2>
      <p class="standfirst">LTV is the contribution a user generates over their expected lifetime: monthly revenue per user, kept margin applied, multiplied by how long the average user stays active. Step by step:</p>
      <table class="ltv-chain">
        <tbody>
          ${ltvSteps.map(ltvRow).join('')}
        </tbody>
      </table>
      <div class="ltv-vs">
        <span><b>${usd(r.ltv)}</b> LTV*</span>
        <span>vs</span>
        <span><b>${usd2(r.blendedCac)}</b> blended CAC</span>
        <span class="vs-arrow">→</span>
        <span><b>${r.ltvCac.toFixed(1)}×</b> LTV:CAC, paid back in <b>${r.cacPaybackMonths.toFixed(1)} months</b></span>
      </div>
      <p class="footnote">* These are assumptions. Pre-product, LTV can't be measured, only assumed: every input above comes from the assumption table, not observed behaviour. The attribution layer exists to replace each of these assumptions with a measurement, starting from the first order.</p>
    </section>

    <section>
      <p class="kicker">Appendix A · Creator cohorts</p>
      <h2>LTV we can measure, per creator.</h2>
      <p class="standfirst">Every creator shares a personal link. When their audience signs up through it, those users are tagged as that creator's cohort, and every order they ever place is attributed back to it. From day one the platform computes the lifetime value of each creator's audience automatically: which creators to double down on, and exactly what a signup from them is worth.</p>
      <div class="flow">
        <div class="flow-step"><b>Creator posts link</b>Catalogs shared to their socials</div>
        <div class="flow-arrow">→</div>
        <div class="flow-step"><b>Audience signs up</b>Users tagged to the creator's cohort</div>
        <div class="flow-arrow">→</div>
        <div class="flow-step"><b>Orders attributed</b>Every purchase tied back to the cohort</div>
        <div class="flow-arrow">→</div>
        <div class="flow-step"><b>Creator LTV</b>Cohort value computed automatically</div>
      </div>
      <div class="cohort-grid">
        <div>${cohortChart}</div>
        <p class="chart-caption">Illustrative: cohorts will price differently. A creator whose audience converts at 1.5× the blended assumption earns more per signup; one below it gets coached or cut. Creator payouts follow measured cohort LTV, not follower counts.</p>
      </div>
    </section>
  </div>

  <!-- Sheet 5 — appendix: the two numbers every decision is held against. -->
  <div class="page">
    <div class="folio"><svg class="folio-logo" viewBox="${CATALOG_LOGO_VIEWBOX}" role="img" aria-label="Catalog"><path fill="#141210" d="${CATALOG_LOGO_PATH}" /></svg><span>Business Plan</span><span class="folio-no">08</span></div>
    <section>
      <p class="kicker">Appendix B · Sensitivity</p>
      <h2>The two numbers that run the company.</h2>
      <p class="standfirst">The model's load-bearing inputs are <b>blended CAC</b> (what a user costs) and <b>product conversion</b> (what a feed impression is worth). Below: the base plan, then CPA at ${usd(cpaLoVal)} and ${usd(cpaHiVal)} against the ${usd(mAcq.cpa)} base, and conversion at ${pctTrim(convLoVal)} and ${pctTrim(convHiVal)} against ${pctTrim(mRev.productConversion)}, with everything else held constant. The ${d.horizonMonths}-month base case earns ${usd(r.total16moRevenue)} of commission on ${usd(r.gmvTotal, true)} GMV.</p>
      <div class="feature-band">
        <div class="feature"><div class="stat-value">${usd2(r.blendedCac)}</div><div class="stat-label">Blended CAC at base · paid CPA ${usd(a.cpa)}</div></div>
        <div class="feature"><div class="stat-value">${pct(rev.productConversion, 2)}</div><div class="stat-label">Product conversion at base · sale per impression</div></div>
      </div>

    </section>

    <section>
      <h3>CAC sensitivity: CPA ${usd(cpaLoVal)} / ${usd(mAcq.cpa)} / ${usd(cpaHiVal)}</h3>
      ${cacChart}
    </section>

    <section>
      <h3>Conversion sensitivity: ${pctTrim(convLoVal)} / ${pctTrim(mRev.productConversion)} / ${pctTrim(convHiVal)}</h3>
      ${convChart}
    </section>

    <section>
      <div class="lens-grid">
        <div class="lens">
          <h4>CAC is the marketing lens.</h4>
          <p>Every channel, creator deal, and campaign is judged by its effect on blended CAC. Attribution measures it automatically per channel and per creator cohort, so budget continuously moves to whatever acquires cheapest.</p>
        </div>
        <div class="lens">
          <h4>Conversion is the product lens.</h4>
          <p>Feed relevance, AI try-on, and checkout friction all express themselves in one number, sales per impression, measured automatically on every session. Every product decision is judged by its effect on it.</p>
        </div>
      </div>
      <p style="margin-top:10px">These two numbers are the leverage that turns the flywheel: better conversion raises LTV, which buys more acquisition at the same ratio; cheaper acquisition compounds the base, which sharpens the data, which raises conversion. Both are measured automatically by the attribution layer, and every decision the company makes is held against its effect on one of the two.<span class="endmark" aria-hidden="true"></span></p>
    </section>

  </div>

  <!-- Sheet 8 — appendix C: the competitive map. -->
  <div class="page">
    <div class="folio"><svg class="folio-logo" viewBox="${CATALOG_LOGO_VIEWBOX}" role="img" aria-label="Catalog"><path fill="#141210" d="${CATALOG_LOGO_PATH}" /></svg><span>Business Plan</span><span class="folio-no">09</span></div>
    <section>
      <p class="kicker">Appendix C · Competitive map</p>
      <h2>The seat nobody is sitting in.</h2>
      <p class="standfirst">Everyone monetizes shopping; no one is built for AI-native discovery. The incumbents bolt AI onto a search funnel, the feeds bury shopping inside entertainment, and the creator platforms monetize links without a destination. The open seat is where taste, creators, and AI meet.</p>
      ${quadrantChart()}
      <p class="chart-caption">Positioning, not market share: the upper right is open because AI-native, discovery-first shopping has no incumbent.</p>
      <div class="solutions">
        <div class="solution">
          <span>The incumbents</span>
          <p>Amazon and ChatGPT shopping own search-first intent: you arrive already knowing what you want. Their AI retrofits an old funnel.</p>
        </div>
        <div class="solution">
          <span>The feeds</span>
          <p>TikTok Shop and Pinterest prove discovery converts, but shopping interrupts the content their users actually came for.</p>
        </div>
        <div class="solution">
          <span>The open seat</span>
          <p>Creator platforms monetize links without a home. Nobody owns AI-native, shopping-first discovery. Catalog is built to.</p>
        </div>
      </div>
    </section>
  </div>

  <!-- Sheet 9 — appendix D: team & hiring, headcount behind proof. -->
  <div class="page">
    <div class="folio"><svg class="folio-logo" viewBox="${CATALOG_LOGO_VIEWBOX}" role="img" aria-label="Catalog"><path fill="#141210" d="${CATALOG_LOGO_PATH}" /></svg><span>Business Plan</span><span class="folio-no">10</span></div>
    <section>
      <p class="kicker">Appendix D · Team &amp; hiring</p>
      <h2>Headcount follows proof.</h2>
      <p class="standfirst">The team scales in the same order as the budget: consultants prove the cycle, a CMO takes ownership of it, and the hungriest consultants convert into the full-time core. Payroll never runs ahead of the machine.</p>
      <div class="flow">
        <div class="flow-step"><b>1 · Founder-led</b>Product, feed, and creator relationships, hands-on</div>
        <div class="flow-arrow">→</div>
        <div class="flow-step"><b>2 · Consultants</b>Three BD and marketing hires, month-to-month</div>
        <div class="flow-arrow">→</div>
        <div class="flow-step"><b>3 · CMO</b>One accountable owner for the proven machine</div>
        <div class="flow-arrow">→</div>
        <div class="flow-step"><b>4 · Convert &amp; scale</b>The hungry become the full-time core</div>
      </div>
      <div class="statband" style="grid-template-columns: repeat(3, 1fr);">
        <div><div class="stat-value">${usd(c.monthlyOpex)}</div><div class="stat-label">Avg monthly OpEx, all-in</div></div>
        <div><div class="stat-value">${pct(d.creatorPayout)}</div><div class="stat-label">Of revenue paid to creators</div></div>
        <div><div class="stat-value">${r.runwayMonths == null ? `${d.horizonMonths}+ mo` : `${r.runwayMonths} mo`}</div><div class="stat-label">Runway on this plan</div></div>
      </div>
      <div class="solutions">
        <div class="solution">
          <span>The principle</span>
          <p>Nobody is hired to figure out whether the machine works. People are hired when the machine has shown it does, to run it harder.</p>
        </div>
        <div class="solution">
          <span>The promise</span>
          <p>Consultants start month-to-month with a real path: prove it through the cycle and convert to full-time. Hungry and aggressive is the bar.</p>
        </div>
        <div class="solution">
          <span>The spend</span>
          <p>Operating cost stays lean and creator-weighted: the largest line is the ${pct(d.creatorPayout)} of revenue redistributed to the people who fill the feed.</p>
        </div>
      </div>
    </section>
  </div>

  <!-- Sheet 10 — aligned incentives: Shopnomix as the investor whose rails
       we run on. Cash from every order + equity upside + exclusivity. -->
  <div class="page">
    <div class="folio"><svg class="folio-logo" viewBox="${CATALOG_LOGO_VIEWBOX}" role="img" aria-label="Catalog"><path fill="#141210" d="${CATALOG_LOGO_PATH}" /></svg><span>Business Plan</span><span class="folio-no">11</span></div>
    <section>
      <p class="kicker">Aligned incentives · To Shopnomix</p>
      <h2>An investment that pays you twice.</h2>
      <p class="standfirst">You built the rails for AI commerce: CPA monetization across tens of thousands of merchants and, with Affiliate.com, a billion-product dataset made for AI surfaces. Catalog is the destination those rails have been missing. Your cheque funds a feed whose every order crosses your links, which makes you a different kind of investor here: one we pay back twice.</p>
      <div class="solutions">
        <div class="solution">
          <span>Cash from the first order</span>
          <p>Catalog routes its affiliate links through your rails, so every sale we drive pays you your cut immediately. The base case pushes ${usd(r.gmvTotal, true)} of GMV through your links in ${d.horizonMonths} months: your investment generates its own revenue as we grow.</p>
        </div>
        <div class="solution">
          <span>An asset that compounds</span>
          <p>The same growth that grows your link revenue grows the value of your stake. One cheque produces cash flow today and asset value tomorrow, and the two reinforce each other.</p>
        </div>
        <div class="solution">
          <span>Exclusive rights</span>
          <p>You hold exclusive rights over the links you carry on Catalog for as long as there isn&rsquo;t a better deal on the table. As the catalog and its AI surfaces grow, that exclusivity appreciates with them.</p>
        </div>
      </div>

      <h3>Your investment, diagrammed against the receivables</h3>
      ${receivablesChart}
      <p class="chart-caption">The solid line is the commission stream crossing your rails (cumulative, base case); the dashed line is the cheque.${investCrossIdx >= 0 ? ` The stream passes the size of the investment itself in month ${investCrossIdx + 1}, and your cut of it flows from the first order.` : ' Your cut of that stream flows from the first order.'}</p>
      <div class="flow">
        <div class="flow-step"><b>Your capital</b>Funds the growth plan</div>
        <div class="flow-arrow">→</div>
        <div class="flow-step"><b>Our growth</b>More shoppers, more orders</div>
        <div class="flow-arrow">→</div>
        <div class="flow-step"><b>Your rails</b>Every order pays your cut</div>
        <div class="flow-arrow">→</div>
        <div class="flow-step"><b>Your upside</b>Cash now, asset value as we scale</div>
      </div>
    </section>

    <div class="footer">
      <b>Catalog</b> · Confidential business plan · Generated ${esc(d.generatedAt)} · ${esc(d.scenario)} scenario, ${d.horizonMonths}-month horizon. Projections are illustrative and depend on the stated assumptions.
    </div>
  </div>
  <script>
    // Posters first (founder's call): videos carry no src until the page
    // — i.e. the poster images — has loaded, then sources attach six at a
    // time so the wall comes alive without ever starving the stills.
    (function () {
      var started = false;
      function start() {
        if (started) return; started = true;
        var vids = Array.prototype.slice.call(document.querySelectorAll('video[data-src]'));
        var i = 0;
        function next() {
          for (var n = 0; n < 6 && i < vids.length; n++, i++) {
            var v = vids[i];
            v.src = v.getAttribute('data-src');
            v.load();
            var p = v.play(); if (p && p.catch) p.catch(function () {});
          }
          if (i < vids.length) setTimeout(next, 400);
        }
        next();
      }
      if (document.readyState === 'complete') setTimeout(start, 300);
      else window.addEventListener('load', function () { setTimeout(start, 300); });
      // Safety: if 'load' hangs on a slow connection, start anyway.
      setTimeout(start, 4000);
    })();
  </script>
</body>
</html>`;
}

// ── Cover collage feed ───────────────────────────────────────────────

/** Pull the whole catalog's product images for the cover wall — every
    active product, poster → primary → raw image fallback. Best-effort:
    any failure (offline, RLS, empty table) falls back to the plain black
    cover. Capped at 120 tiles so the document stays light. */
async function fetchFeedImages(count = 120): Promise<Array<{ video: string; poster: string }>> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('primary_video_url, primary_video_poster_url, primary_image_url')
      .eq('is_active', true)
      .not('primary_video_url', 'is', null)
      .limit(500);
    if (error || !data) return [];
    const seen = new Set<string>();
    const media: Array<{ video: string; poster: string }> = [];
    for (const row of data as Array<{ primary_video_url: string | null; primary_video_poster_url: string | null; primary_image_url: string | null }>) {
      const video = row.primary_video_url;
      if (!video || !/^https?:\/\//i.test(video) || seen.has(video)) continue;
      seen.add(video);
      const rawPoster = row.primary_video_poster_url || row.primary_image_url || '';
      media.push({ video, poster: rawPoster ? (withTransform(rawPoster, { width: 320, quality: 60 }) ?? rawPoster) : '' });
      if (media.length >= count) break;
    }
    return media;
  } catch {
    return [];
  }
}

const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p, new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms))]);

/** Open the business plan in a new tab (reader can Save as PDF from there). */
export async function openBusinessPlan(d: BusinessPlanData): Promise<void> {
  if (typeof window === 'undefined') return;
  // Open synchronously inside the click gesture so popup blockers allow it,
  // then fill the document once the cover collage has been fetched.
  const w = window.open('', '_blank');
  const feedImages = await withTimeout(fetchFeedImages(), 5000, []);
  const html = buildBusinessPlanHtml({ ...d, feedImages });
  // Snapshot for the public passcode viewer (/business-plan): latest open wins.
  void supabase.from('documents').upsert(
    { key: 'business-plan', html, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
  if (!w) {
    // Popup blocked — fall back to a download.
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'catalog-business-plan.html';
    document.body.appendChild(link); link.click(); link.remove();
    URL.revokeObjectURL(url);
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
