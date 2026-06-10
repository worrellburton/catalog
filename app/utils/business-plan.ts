// Business-plan generator for the admin Model page. Takes the live model
// snapshot (assumptions + projected results) and renders a complete,
// Catalog-branded business plan as a self-contained HTML document that opens
// in a new tab — the reader can save it to PDF from there. Ordered the way
// the founder asked: target customer first, then the product / market / GTM,
// then the financials WITH their assumptions.

import { CATALOG_LOGO_PATH, CATALOG_LOGO_VIEWBOX } from '~/constants/brand-logo';

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
  results: {
    exitArr: number;
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
}

const usd = (n: number, compact = false): string => {
  if (compact && Math.abs(n) >= 1000) {
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    return `$${Math.round(n / 1000)}K`;
  }
  return `$${Math.round(n).toLocaleString('en-US')}`;
};
const num = (n: number): string => Math.round(n).toLocaleString('en-US');
const pct = (frac: number, dp = 0): string => `${(frac * 100).toFixed(dp)}%`;
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Build the full business-plan HTML document string. */
export function buildBusinessPlanHtml(d: BusinessPlanData): string {
  const r = d.results;
  const a = d.acquisition;
  const e = d.engagement;
  const rev = d.revenue;
  const c = d.costs;
  // null runway = cash survives the whole horizon.
  const runwayLabel = r.runwayMonths == null ? `${d.horizonMonths}+ mo` : `${r.runwayMonths} mo`;
  const runwayWords = r.runwayMonths == null ? `more than ${d.horizonMonths} months` : `${r.runwayMonths} months`;

  // Assumption rows: label, value, the benchmark/why.
  const assumptions: Array<[string, string, string]> = [
    ['Total advertising spend', usd(a.budget), `over ${d.horizonMonths} months`],
    ['Blended CPA (paid)', usd(a.cpa), 'cost per acquired user · $5-30 consumer benchmark'],
    ['Organic / word-of-mouth growth', `${pct(a.organicGrowth)} / mo`, 'referral adds as a % of the base · 10-30%/mo early'],
    ['Budget split (early / late)', `${pct(a.budgetSplitEarly)} / ${pct(a.budgetSplitLate)}`, 'share of spend front-loaded vs. tail'],
    ['New-user retention (M1)', pct(a.newUserRetention), 'returns next month · 25-45% M1 benchmark'],
    ['Monthly active churn', pct(a.monthlyActiveChurn), 'retained base lost / mo · 3-6%/mo'],
    ['Sessions / user / mo', num(e.sessionsPerUserPerMonth), 'engagement depth · 6-12 benchmark'],
    ['Session length', `${num(e.sessionTimeMinutes)} min`, 'avg time per session · 3-6 min'],
    ['Impressions / session', num(e.impressionsPerSession), 'product views per session · 10-40'],
    ['Product conversion', pct(rev.productConversion, 2), 'sale per impression · 1-2% marketplace'],
    ['Average order value', usd(rev.avgOrderValue), 'AOV · $40-120'],
    ['Affiliate commission', pct(rev.affiliateCommission), 'take rate per sale · 8-15%'],
    ['Creator payout', pct(d.creatorPayout), 'share of revenue paid back to creators'],
    ['Gross margin', pct(c.grossMargin), ''],
    ['Monthly OpEx (avg)', usd(c.monthlyOpex), 'payroll + expenses + creator payout'],
    ['Cash raised', usd(c.cashRaised), 'starting cash this plan is built on'],
  ];

  // Headline results.
  const headline: Array<[string, string, string]> = [
    ['Exit ARR', usd(r.exitArr), `run-rate at month ${d.horizonMonths}`],
    [`${d.horizonMonths}-mo revenue`, usd(r.total16moRevenue), 'commission earned'],
    ['GMV', usd(r.gmvTotal, true), 'gross merchandise value driven'],
    ['Total sales', num(r.totalSales), 'orders'],
    ['Avg MAU', num(r.avgMau), 'monthly active users'],
    ['LTV', usd(r.ltv), 'lifetime value per user'],
    ['LTV : CAC', `${r.ltvCac.toFixed(1)}×`, '≥3× is healthy'],
    ['CAC payback', `${r.cacPaybackMonths.toFixed(1)} mo`, 'months to recover acquisition cost'],
    ['Blended CAC', usd(r.blendedCac), 'paid + organic'],
    ['Avg monthly burn', usd(r.avgBurn, true), ''],
    ['Runway', runwayLabel, 'on current cash'],
  ];

  const card = ([label, value, sub]: [string, string, string]) => `
    <div class="metric">
      <div class="metric-label">${esc(label)}</div>
      <div class="metric-value">${esc(value)}</div>
      ${sub ? `<div class="metric-sub">${esc(sub)}</div>` : ''}
    </div>`;

  const assumptionRow = ([label, value, why]: [string, string, string]) => `
    <tr>
      <td class="a-label">${esc(label)}</td>
      <td class="a-value">${esc(value)}</td>
      <td class="a-why">${esc(why)}</td>
    </tr>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Catalog Business Plan</title>
<style>
  :root { --ink:#0f172a; --muted:#64748b; --line:#e7e9ef; --indigo:#6366f1; --green:#10b981; --paper:#ffffff; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #f3f4f8; color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
    line-height: 1.6; -webkit-font-smoothing: antialiased; }
  .page { max-width: 860px; margin: 0 auto; padding: 56px 64px 80px; background: var(--paper); }
  .toolbar { position: sticky; top: 0; display: flex; justify-content: flex-end; gap: 8px;
    padding: 12px 16px; background: rgba(243,244,248,0.9); backdrop-filter: blur(8px); }
  .toolbar button { font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
    border: 1px solid var(--line); background: #fff; color: var(--ink); border-radius: 8px; padding: 8px 14px; }
  .toolbar button.primary { background: var(--indigo); color: #fff; border-color: var(--indigo); }
  @media print { .toolbar { display: none; } body { background: #fff; }
    .page { padding: 0; max-width: none; }
    .cover-page { min-height: 100vh; page-break-after: always; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }

  /* Cover — its own full black page, white wordmark (the real logo), no spark. */
  .cover-page { background: #000; color: #fff; min-height: 100vh;
    display: flex; flex-direction: column; justify-content: center; align-items: flex-start; padding: 72px 64px; }
  .cover-logo { width: clamp(200px, 30vw, 300px); height: auto; display: block; margin-bottom: 44px; }
  .cover-page .doc-title { margin: 0 0 10px; color: #fff; }
  .cover-page .doc-sub { color: rgba(255,255,255,0.72); }
  .cover-page .doc-meta { color: rgba(255,255,255,0.5); }
  .cover-page .doc-meta b { color: #fff; }
  .doc-title { font-size: 44px; font-weight: 800; letter-spacing: -0.035em; line-height: 1.05; }
  .doc-sub { margin: 0; color: var(--muted); font-size: 15px; }
  .doc-meta { margin-top: 14px; font-size: 12px; color: var(--muted); letter-spacing: 0.02em; }
  .doc-meta b { color: var(--ink); text-transform: capitalize; }

  section { margin: 0 0 38px; }
  .kicker { font-size: 11px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: var(--indigo); margin: 0 0 8px; }
  h2 { font-size: 24px; font-weight: 800; letter-spacing: -0.02em; margin: 0 0 12px; }
  h3 { font-size: 15px; font-weight: 700; margin: 18px 0 4px; }
  p { margin: 0 0 12px; color: #334155; }
  ul { margin: 0 0 12px; padding-left: 20px; color: #334155; }
  li { margin: 0 0 6px; }

  .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 6px 0 8px; }
  .metric { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: #fcfcfe; }
  .metric-label { font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
  .metric-value { font-size: 22px; font-weight: 800; letter-spacing: -0.01em; margin-top: 2px; }
  .metric-sub { font-size: 11px; color: var(--muted); margin-top: 2px; }

  table.assumptions { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 6px; }
  table.assumptions th { text-align: left; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--muted); padding: 6px 10px; border-bottom: 2px solid var(--line); }
  table.assumptions td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  .a-label { font-weight: 600; color: var(--ink); width: 32%; }
  .a-value { font-weight: 700; width: 20%; font-variant-numeric: tabular-nums; }
  .a-why { color: var(--muted); }

  .pillars { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .pillar { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
  .pillar h4 { margin: 0 0 4px; font-size: 14px; }
  .pillar p { margin: 0; font-size: 12.5px; color: var(--muted); }
  .pillar .w { font-size: 11px; font-weight: 700; color: var(--green); }

  .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--line); font-size: 11px; color: var(--muted); }
  .disclaimer { font-size: 11px; color: var(--muted); font-style: italic; }
</style>
</head>
<body>
  <div class="toolbar">
    <button class="primary" onclick="window.print()">Save as PDF</button>
  </div>
  <div class="cover-page">
    <svg class="cover-logo" viewBox="${CATALOG_LOGO_VIEWBOX}" role="img" aria-label="Catalog"><path fill="#ffffff" d="${CATALOG_LOGO_PATH}" /></svg>
    <h1 class="doc-title">Business Plan</h1>
    <p class="doc-sub">The shopping app for everything: one platform, web plus iOS and Android, one user base.</p>
    <div class="doc-meta">Generated ${esc(d.generatedAt)} · Financial scenario: <b>${esc(d.scenario)}</b> · ${d.horizonMonths}-month horizon</div>
  </div>
  <div class="page">
    <section>
      <p class="kicker">Executive summary</p>
      <h2>A single shopping destination that earns on every sale it drives.</h2>
      <p>Catalog is one consumer shopping app, a single platform across web and iOS/Android with one unified user base, that turns short, shoppable video into a visual storefront for everything people buy. We don't hold inventory; we earn affiliate commission on the sales we drive, so the model scales with attention rather than logistics. This plan projects <b>${usd(r.total16moRevenue)}</b> in commission revenue over ${d.horizonMonths} months on <b>${usd(r.gmvTotal, true)}</b> of GMV, exiting at <b>${usd(r.exitArr)}</b> ARR with an LTV:CAC of <b>${r.ltvCac.toFixed(1)}×</b> and ${r.cacPaybackMonths.toFixed(1)}-month CAC payback.</p>
    </section>

    <section>
      <p class="kicker">01 · Target customer</p>
      <h2>The shopper who lives in their feed.</h2>
      <p>Our core customer is the everyday consumer who already discovers products by scrolling, the same person who screenshots outfits, saves links, and asks friends "where's that from?" They are mobile-first, visually driven, and shop across categories: apparel, beauty, home, and lifestyle. They don't want a search box and ten blue links; they want a feed that already knows their taste and a frictionless path from "I want that" to checkout.</p>
      <ul>
        <li><b>Who:</b> mainstream online shoppers (think the audience of Amazon, Pinterest, and TikTok Shop), not a fashion-only niche.</li>
        <li><b>Behavior:</b> discovery-led, impulse-friendly, returns daily: ${num(e.sessionsPerUserPerMonth)} sessions/user/mo at ~${num(e.sessionTimeMinutes)} min each.</li>
        <li><b>Pain:</b> taste is scattered across screenshots and tabs; existing shopping apps are either a search utility or a single brand's store.</li>
        <li><b>Why us:</b> one feed, every brand, tuned to the individual; a personal storefront that gets sharper with every tap, save, and shop.</li>
      </ul>
    </section>

    <section>
      <p class="kicker">02 · Product</p>
      <h2>Shoppable video, indexed by AI.</h2>
      <p>Every look is a short video paired with its products. We encode each one into a vector database, where composition, color, garment, and mood become coordinates a model can reason about, so the feed can surface visually similar products in ~12ms. Creators publish looks; brands' catalogs sync automatically; AI generates and polishes the creative. A shopper taps a look, sees the exact products, and checks out through the merchant, with the sale attributed back to us.</p>
    </section>

    <section>
      <p class="kicker">03 · Market &amp; opportunity</p>
      <h2>Discovery commerce, where the spend is moving.</h2>
      <p>Commerce is shifting from search to feed. Social platforms proved that shoppable video converts, but they bury it inside content people came for other reasons to see. Catalog is the destination built for it: a shopping-first feed across every brand, with attribution and unit economics designed in from day one. We monetize the intent that social platforms create but don't own.</p>
    </section>

    <section>
      <p class="kicker">04 · Go-to-market</p>
      <h2>A marketing engine that compounds.</h2>
      <p>Marketing is run as a system by a small, disciplined team (not a single person doing everything), built on creators as the primary channel. Budget is allocated across three pillars:</p>
      <div class="pillars">
        <div class="pillar"><span class="w">60%</span><h4>Digital Marketing</h4><p>The performance and organic engine: SEO, paid, social, lifecycle, ASO. Drives installs and sessions at a ~${usd(a.cpa)} blended CPA.</p></div>
        <div class="pillar"><span class="w">25%</span><h4>Business Development</h4><p>Supply and distribution: creators, brands, and affiliate networks that fill the feed and the catalog.</p></div>
        <div class="pillar"><span class="w">15%</span><h4>Strategy &amp; Branding</h4><p>Positioning, brand, and measurement: why this is THE shopping app, tied back to the model.</p></div>
      </div>
      <p style="margin-top:14px">The plan: hire a few BD/marketing operators, market through creators (we pay them on signups and ongoing engagement), deploy budget against weekly targets logged in a CRM, then learn and repeat every cycle to drive CPA down.</p>
    </section>

    <section>
      <p class="kicker">05 · Business model &amp; unit economics</p>
      <h2>We earn a take rate on the sales we drive.</h2>
      <p>Revenue = impressions × product conversion × average order value × affiliate commission. Each acquired user is worth <b>${usd(r.ltv)}</b> in lifetime value against a blended CAC of <b>${usd(r.blendedCac)}</b>, an LTV:CAC of <b>${r.ltvCac.toFixed(1)}×</b> that pays back in <b>${r.cacPaybackMonths.toFixed(1)} months</b>. Word-of-mouth adds ${pct(a.organicGrowth)} of the base per month, so blended CAC falls as the organic loop strengthens.</p>
    </section>

    <section>
      <p class="kicker">06 · Financial plan</p>
      <h2>${d.horizonMonths}-month projection (${esc(d.scenario)} case).</h2>
      <div class="metrics">
        ${headline.map(card).join('')}
      </div>
      <p class="disclaimer">Figures are model projections generated from the assumptions below, not guarantees.</p>

      <h3>Assumptions the plan is built on</h3>
      <table class="assumptions">
        <thead><tr><th>Assumption</th><th>Value</th><th>Why / benchmark</th></tr></thead>
        <tbody>
          ${assumptions.map(assumptionRow).join('')}
        </tbody>
      </table>
    </section>

    <section>
      <p class="kicker">07 · Use of funds</p>
      <h2>Capital to turn the flywheel on.</h2>
      <p>This plan runs on <b>${usd(c.cashRaised)}</b> of cash at an average monthly burn of <b>${usd(r.avgBurn, true)}</b>, giving <b>${runwayWords}</b> of runway. Capital goes into the marketing engine above (acquisition + creator/brand supply) and the team that runs it, with the goal of compounding organic growth and driving CAC down each cycle.</p>
    </section>

    <div class="footer">
      Catalog · Confidential business plan · Generated ${esc(d.generatedAt)}. Projections are illustrative and depend on the stated assumptions.
    </div>
  </div>
</body>
</html>`;
}

/** Open the business plan in a new tab (reader can Save as PDF from there). */
export function openBusinessPlan(d: BusinessPlanData): void {
  if (typeof window === 'undefined') return;
  const html = buildBusinessPlanHtml(d);
  const w = window.open('', '_blank');
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
