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
//     sensitivity — the two numbers every decision is held to.

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
  /** Product-feed poster URLs for the cover collage (injected at open time). */
  feedImages?: string[];
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
  const pad = { l: 46, r: 150, t: opts.axisLabel ? 26 : 10, b: 20 };
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
  const [coverCols, coverRows] = feed.length >= 100 ? [10, 10]
    : feed.length >= 81 ? [9, 9]
    : feed.length >= 64 ? [8, 8]
    : feed.length >= 36 ? [6, 6]
    : [4, 5];
  const coverTiles = feed.length
    ? Array.from({ length: coverCols * coverRows }, (_, i) => `<img src="${esc(feed[i % feed.length])}" alt="" loading="eager" />`).join('')
    : '';
  const coverGridStyle = `grid-template-columns: repeat(${coverCols}, minmax(0, 1fr)); grid-template-rows: repeat(${coverRows}, minmax(0, 1fr));`;


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

  // GTM flywheel — condensed from the /admin/gtm flywheel deck.
  const gtmSteps: Array<[string, string, string]> = [
    ['1', 'Hire.', 'Three BD and marketing consultants, month-to-month for three months, specialised in creator relations. Start small and scale what converts. Marketing is a system run by people, and it needs to start being built.'],
    ['2', 'Deploy budget effectively.', 'A disciplined, mission-driven team deploying the budget as effectively as possible: every contact logged in the CRM, weekly targets held to, laser-focused on driving CPA down.'],
    ['3', 'Learn and repeat.', 'Continuous improvement every cycle: lean into what is working, cut what is not, tighten strategy, campaigns, and creator management. Drive CPA as low as it will go.'],
  ];
  const gtmStepRow = ([no, title, body]: [string, string, string]) => `
    <div class="step">
      <span class="step-no">${esc(no)}</span>
      <div>
        <h4>${esc(title)}</h4>
        <p>${esc(body)}</p>
      </div>
    </div>`;

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
<meta name="viewport" content="width=device-width, initial-scale=1" />
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
    .toolbar { display: none; }
    body { background: #fff; font-size: 9px; line-height: 1.5;
      -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { padding: 26px 34px; max-width: none; margin: 0; box-shadow: none;
      page-break-before: always; background: var(--paper); }
    .cover-page { min-height: 100vh; page-break-after: always; }
    section { page-break-inside: avoid; break-inside: avoid; margin-bottom: 18px; }
    .statband, .phases, .lens-grid, .lens, .feature-band, .chart, .flow, .steps,
    .features, table.ltv-chain { page-break-inside: avoid; break-inside: avoid; }
    .solutions { page-break-inside: avoid; break-inside: avoid; margin-top: 20px; }
    .solution p { font-size: 9.5px; }
    .folio { margin-bottom: 18px; }
    .divider { min-height: 82vh; }
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
    .step { padding: 10px 0; }
    .step p { font-size: 9.5px; }
    .statband { padding: 12px 0; }
    .footer { margin-top: 14px; padding-top: 8px; }
  }

  /* ── Cover: the product feed, full color, behind the wordmark. ── */
  .cover-page { position: relative; overflow: hidden; background: #000; color: #fff; min-height: 100vh;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 26px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* Grid columns/rows arrive inline — density scales with image count.
     Uniform white cards with a dark gutter: products stay uncropped
     inside identical tiles, so the wall reads even and together. */
  .cover-feed { position: absolute; inset: 0; display: grid; gap: 6px; padding: 6px; background: #000; }
  .cover-feed img { width: 100%; height: 100%; min-width: 0; min-height: 0;
    object-fit: contain; background: #fff; padding: 5px; box-sizing: border-box; display: block; }
  .cover-scrim { position: absolute; inset: 0;
    background: linear-gradient(rgba(0,0,0,0.66), rgba(0,0,0,0.80)); }
  .cover-logo { position: relative; z-index: 1; width: clamp(240px, 38vw, 400px); height: auto; display: block;
    filter: drop-shadow(0 4px 28px rgba(0,0,0,0.55)); }
  .cover-tagline { position: relative; z-index: 1; margin: 0;
    font-size: 15px; font-weight: 500; letter-spacing: 0.24em; text-transform: uppercase;
    color: rgba(255,255,255,0.95); text-shadow: 0 2px 14px rgba(0,0,0,0.6); }

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
  .steps { margin-top: 10px; }
  .step { display: grid; grid-template-columns: 70px 1fr; gap: 20px; align-items: start; padding: 16px 0; }
  .step + .step { border-top: 1px solid var(--line); }
  .step-no { font-size: 38px; line-height: 0.85; font-weight: 700; color: var(--ink); }
  .step h4 { margin: 0 0 4px; font-size: 13px; letter-spacing: -0.01em; }
  .step p { margin: 0; font-size: 11px; color: #45403a; max-width: 64ch; }

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
  </div>

  <!-- Sheet 1 — magazine: centered summary, market, customer. -->
  <div class="page">
    <div class="folio"><svg class="folio-logo" viewBox="${CATALOG_LOGO_VIEWBOX}" role="img" aria-label="Catalog"><path fill="#141210" d="${CATALOG_LOGO_PATH}" /></svg><span>Business Plan</span><span class="folio-no">02</span></div>
    <section class="exec">
      <p class="kicker">Executive summary</p>
      <h2 class="display">The shopping destination where discovery converts.</h2>
      <p>Catalog is your daily feed for everything you shop: one consumer app across web, iOS, and Android with a single user base, turning short, shoppable video into a personal storefront. Shoppers scroll a feed tuned to their taste, tap a look, see the exact products in it, and check out with the merchant. We hold no inventory, so the business scales with attention rather than logistics.</p>
      <p>Revenue starts with affiliate commission on every sale we drive. That is the model these projections are built on. Advertising and direct brand partnerships follow on the same rails, and are upside on top of every figure in this plan.</p>
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

  <!-- Sheet 3 — go-to-market: creators + AI-driven content, three steps. -->
  <div class="page">
    <div class="folio"><svg class="folio-logo" viewBox="${CATALOG_LOGO_VIEWBOX}" role="img" aria-label="Catalog"><path fill="#141210" d="${CATALOG_LOGO_PATH}" /></svg><span>Business Plan</span><span class="folio-no">04</span></div>
    <section>
      <p class="kicker">05 · Go-to-market</p>
      <h2>This is just the beginning.</h2>
      <p class="standfirst">Everything in this plan runs on the simplest version of the machine: marketing through creators, our primary advertising channel. Creators post their link, build catalogs, and share them with their audience; they are paid on every signup they bring and on that audience's ongoing engagement. Word-of-mouth adds ${pct(a.organicGrowth)} of the base each month on top of paid acquisition at a ~${usd(a.cpa)} blended CPA.</p>
      <div class="steps">
        ${gtmSteps.map(gtmStepRow).join('')}
      </div>
      <div class="ai-banner">
        <p class="kicker">Strategic marketing experiment</p>
        <p>Running alongside the core motion: AI-driven content. Users try products on with AI, build catalogs of what they love, and post them. The people we acquire also make the content that acquires the next wave: creation compounds while production cost doesn't.</p>
      </div>
    </section>
  </div>

  <!-- Sheet 4 — appendix divider: just the word, centered. -->
  <div class="page">
    <div class="folio"><svg class="folio-logo" viewBox="${CATALOG_LOGO_VIEWBOX}" role="img" aria-label="Catalog"><path fill="#141210" d="${CATALOG_LOGO_PATH}" /></svg><span>Business Plan</span></div>
    <div class="divider">
      <h2 class="display">Appendix</h2>
    </div>
  </div>

  <!-- Sheet 5 — LTV: assumption-flagged breakdown + creator cohorts. -->
  <div class="page">
    <div class="folio"><svg class="folio-logo" viewBox="${CATALOG_LOGO_VIEWBOX}" role="img" aria-label="Catalog"><path fill="#141210" d="${CATALOG_LOGO_PATH}" /></svg><span>Business Plan</span><span class="folio-no">06</span></div>
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
    <div class="folio"><svg class="folio-logo" viewBox="${CATALOG_LOGO_VIEWBOX}" role="img" aria-label="Catalog"><path fill="#141210" d="${CATALOG_LOGO_PATH}" /></svg><span>Business Plan</span><span class="folio-no">07</span></div>
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

    <div class="footer">
      <b>Catalog</b> · Confidential business plan · Generated ${esc(d.generatedAt)} · ${esc(d.scenario)} scenario, ${d.horizonMonths}-month horizon. Projections are illustrative and depend on the stated assumptions.
    </div>
  </div>
</body>
</html>`;
}

// ── Cover collage feed ───────────────────────────────────────────────

/** Pull the whole catalog's product images for the cover wall — every
    active product, poster → primary → raw image fallback. Best-effort:
    any failure (offline, RLS, empty table) falls back to the plain black
    cover. Capped at 120 tiles so the document stays light. */
async function fetchFeedImages(count = 120): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('primary_video_poster_url, primary_image_url, image_url')
      .eq('is_active', true)
      .limit(500);
    if (error || !data) return [];
    const urls = data
      .map(p => p.primary_video_poster_url || p.primary_image_url || p.image_url)
      .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u));
    return [...new Set(urls)]
      .slice(0, count)
      .map(u => withTransform(u, { width: 320, quality: 60 }) ?? u);
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
