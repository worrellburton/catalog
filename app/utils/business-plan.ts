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
//   - "Your daily feed" leads the cover.
//   - Marketing is a SYSTEM (not an engine), with no budget-split numbers.
//   - The whole document prints to THREE pages: cover + two content sheets
//     (hard page breaks between them; copy is kept tight on purpose — when
//     adding content, cut something else on the same sheet).

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

  // Assumption rows kept to the load-bearing ten so the table fits the
  // two-sheet budget: label, value, the benchmark/why.
  const assumptions: Array<[string, string, string]> = [
    ['Total advertising spend', usd(a.budget), `over ${d.horizonMonths} months`],
    ['Blended CPA (paid)', usd(a.cpa), '$5-30 consumer benchmark'],
    ['Organic growth', `${pct(a.organicGrowth)} / mo`, 'referral adds · 10-30%/mo early'],
    ['New-user retention (M1)', pct(a.newUserRetention), '25-45% M1 benchmark'],
    ['Monthly active churn', pct(a.monthlyActiveChurn), '3-6%/mo'],
    ['Sessions / user / mo', num(e.sessionsPerUserPerMonth), '6-12 benchmark'],
    ['Product conversion', pct(rev.productConversion, 2), '1-2% marketplace'],
    ['Average order value', usd(rev.avgOrderValue), '$40-120'],
    ['Affiliate commission', pct(rev.affiliateCommission), '8-15% take rate'],
    ['Monthly OpEx (avg)', usd(c.monthlyOpex), `incl. ${pct(d.creatorPayout)} creator payout`],
  ];

  // Headline results — six cards, one row of three each in print. The
  // model's end-of-horizon run-rate is presented as exactly that — never
  // as an "exit".
  const headline: Array<[string, string, string]> = [
    ['Run-rate ARR', usd(r.exitArr), `annualised at month ${d.horizonMonths}`],
    [`${d.horizonMonths}-mo revenue`, usd(r.total16moRevenue), 'commission earned'],
    ['GMV', usd(r.gmvTotal, true), `${num(r.totalSales)} orders`],
    ['LTV : CAC', `${r.ltvCac.toFixed(1)}×`, `${usd(r.ltv)} LTV · ${usd(r.blendedCac)} CAC`],
    ['CAC payback', `${r.cacPaybackMonths.toFixed(1)} mo`, `${num(r.avgMau)} avg MAU`],
    ['Runway', runwayLabel, `${usd(r.avgBurn, true)}/mo avg burn`],
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
  :root { --ink:#0f172a; --muted:#64748b; --line:#e7e9ef; --indigo:#6366f1; --paper:#ffffff; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #f3f4f8; color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
    line-height: 1.55; -webkit-font-smoothing: antialiased; }
  .page { max-width: 860px; margin: 0 auto; padding: 48px 64px 56px; background: var(--paper); }
  .toolbar { position: sticky; top: 0; display: flex; justify-content: flex-end; gap: 8px;
    padding: 12px 16px; background: rgba(243,244,248,0.9); backdrop-filter: blur(8px); }
  .toolbar button { font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
    border: 1px solid var(--line); background: #fff; color: var(--ink); border-radius: 8px; padding: 8px 14px; }
  .toolbar button.primary { background: var(--indigo); color: #fff; border-color: var(--indigo); }

  /* Print: cover + exactly two content sheets. Type tightens a step so each
     sheet's content fits one page; sections never split across pages. */
  @media print {
    .toolbar { display: none; }
    body { background: #fff; font-size: 11px; line-height: 1.4; }
    .page { padding: 0; max-width: none; }
    .cover-page { min-height: 100vh; page-break-after: always; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .sheet-2 { page-break-before: always; }
    section { page-break-inside: avoid; margin-bottom: 16px; }
    .kicker { margin-bottom: 3px; }
    h2 { font-size: 16px; margin-bottom: 6px; }
    p { margin-bottom: 7px; }
    .metric { padding: 8px 10px; }
    .metric-value { font-size: 15px; }
    .metrics { gap: 8px; }
    table.assumptions { font-size: 10.5px; }
    table.assumptions td { padding: 4px 8px; }
    .phases, .pillars { gap: 8px; }
    .phase, .pillar { padding: 9px 11px; }
    .phase h4, .pillar h4 { font-size: 12px; }
    .phase p, .pillar p { font-size: 10.5px; line-height: 1.4; }
    .footer { margin-top: 14px; padding-top: 8px; }
  }

  /* Cover — its own full black page, white wordmark (the real logo). */
  .cover-page { background: #000; color: #fff; min-height: 100vh;
    display: flex; flex-direction: column; justify-content: center; align-items: flex-start; padding: 72px 64px; }
  .cover-logo { width: clamp(200px, 30vw, 300px); height: auto; display: block; margin-bottom: 44px; }
  .cover-page .doc-title { margin: 0 0 10px; color: #fff; }
  .cover-page .doc-sub { color: rgba(255,255,255,0.72); }
  .cover-page .doc-meta { color: rgba(255,255,255,0.5); }
  .cover-page .doc-meta b { color: #fff; }
  .doc-title { font-size: 44px; font-weight: 800; letter-spacing: -0.035em; line-height: 1.05; }
  .doc-sub { margin: 0; color: var(--muted); font-size: 16px; }
  .doc-sub .lead { color: #fff; font-weight: 700; }
  .doc-meta { margin-top: 14px; font-size: 12px; color: var(--muted); letter-spacing: 0.02em; }
  .doc-meta b { color: var(--ink); text-transform: capitalize; }

  section { margin: 0 0 26px; }
  .kicker { font-size: 11px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: var(--indigo); margin: 0 0 6px; }
  h2 { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; margin: 0 0 10px; }
  h3 { font-size: 14px; font-weight: 700; margin: 14px 0 4px; }
  p { margin: 0 0 10px; color: #334155; }

  .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 6px 0 8px; }
  .metric { border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; background: #fcfcfe; }
  .metric-label { font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
  .metric-value { font-size: 21px; font-weight: 800; letter-spacing: -0.01em; margin-top: 2px; }
  .metric-sub { font-size: 11px; color: var(--muted); margin-top: 2px; }

  table.assumptions { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 4px; }
  table.assumptions th { text-align: left; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--muted); padding: 5px 10px; border-bottom: 2px solid var(--line); }
  table.assumptions td { padding: 6px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  .a-label { font-weight: 600; color: var(--ink); width: 36%; }
  .a-value { font-weight: 700; width: 22%; font-variant-numeric: tabular-nums; }
  .a-why { color: var(--muted); }

  .pillars { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .pillar { border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
  .pillar h4 { margin: 0 0 4px; font-size: 13.5px; }
  .pillar p { margin: 0; font-size: 12px; color: var(--muted); }

  /* Revenue roadmap — three phases that build on each other. */
  .phases { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 6px 0 10px; }
  .phase { border: 1px solid var(--line); border-radius: 12px; padding: 14px; }
  .phase.now { border-color: var(--indigo); background: #fafaff; }
  .phase-stage { font-size: 10px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: var(--indigo); }
  .phase-stage .tag { display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 999px;
    background: var(--indigo); color: #fff; font-size: 9px; letter-spacing: 0.06em; vertical-align: 1px; }
  .phase h4 { margin: 5px 0 5px; font-size: 14px; letter-spacing: -0.01em; }
  .phase p { margin: 0; font-size: 12px; color: var(--muted); line-height: 1.5; }
  .phase-note { font-size: 11.5px; color: var(--muted); font-style: italic; }

  .footer { margin-top: 28px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 11px; color: var(--muted); }
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
    <p class="doc-sub"><span class="lead">Your daily feed.</span> The shopping app for everything — one platform across web, iOS, and Android, one user base.</p>
    <div class="doc-meta">Generated ${esc(d.generatedAt)} · Financial scenario: <b>${esc(d.scenario)}</b> · ${d.horizonMonths}-month horizon</div>
  </div>

  <!-- Sheet 1 — the story: summary, market, customer, product, revenue model. -->
  <div class="page sheet-1">
    <section>
      <p class="kicker">Executive summary</p>
      <h2>The shopping destination where discovery converts.</h2>
      <p>Catalog is your daily feed for everything you shop — one consumer app across web, iOS, and Android with a single user base, turning short, shoppable video into a personal storefront. Shoppers scroll a feed tuned to their taste, tap a look, see the exact products in it, and check out with the merchant. We hold no inventory, so the business scales with attention rather than logistics.</p>
      <p>Revenue starts with affiliate commission on every sale we drive — the model this plan's projections are built on. As the audience and conversion data compound, the same feed opens two larger lines we already have the rails for: native advertising sold against proven purchase intent, and direct brand partnerships at negotiated take rates above affiliate baselines. Each phase funds and de-risks the next. On affiliate economics alone, the plan projects <b>${usd(r.total16moRevenue)}</b> of commission revenue over ${d.horizonMonths} months on <b>${usd(r.gmvTotal, true)}</b> of GMV, reaching a <b>${usd(r.exitArr)}</b> run-rate ARR by month ${d.horizonMonths} at an LTV:CAC of <b>${r.ltvCac.toFixed(1)}×</b>.</p>
    </section>

    <section>
      <p class="kicker">01 · Market &amp; opportunity</p>
      <h2>Discovery commerce, where the spend is moving.</h2>
      <p>Commerce is shifting from search to feed. Social platforms proved that shoppable video converts, but they bury it inside content people came to see for other reasons — entertainment first, shopping as an interruption. Catalog is the destination built for it: a shopping-first daily feed across every brand, with attribution and unit economics designed in from day one. We monetize the purchase intent that social platforms create but don't own.</p>
    </section>

    <section>
      <p class="kicker">02 · Target customer</p>
      <h2>The shopper who lives in their feed.</h2>
      <p>Our core customer is the everyday consumer who already discovers products by scrolling — the person who screenshots outfits, saves links, and asks "where's that from?" They are mobile-first, visually driven, and shop across categories: apparel, beauty, home, lifestyle. Think the audience of Amazon, Pinterest, and TikTok Shop, not a fashion-only niche — discovery-led, impulse-friendly, returning ${num(e.sessionsPerUserPerMonth)} times a month for ~${num(e.sessionTimeMinutes)}-minute sessions. Their taste is scattered across screenshots and tabs; we give them one feed, every brand, tuned to the individual — a personal storefront that gets sharper with every tap, save, and shop.</p>
    </section>

    <section>
      <p class="kicker">03 · Product</p>
      <h2>Shoppable video, indexed by AI.</h2>
      <p>Every look is a short video paired with its products. We encode each one into a vector database — composition, color, garment, and mood become coordinates a model can reason about — so the feed surfaces visually similar products in ~12ms. Creators publish looks, brands' catalogs sync automatically, AI generates and polishes the creative, and every sale is attributed back to us. That attribution layer is the strategic asset: first-party conversion data that personalises the feed today and becomes the sales story for advertisers and brand partners tomorrow.</p>
    </section>
    <section>
      <p class="kicker">04 · Revenue model</p>
      <h2>Three revenue lines, unlocked in sequence.</h2>
      <div class="phases">
        <div class="phase now">
          <div class="phase-stage">Phase 1 <span class="tag">Now</span></div>
          <h4>Affiliate commission</h4>
          <p>We earn ${pct(rev.affiliateCommission)} on every sale we drive, via affiliate networks and merchants' own programs. No inventory, revenue from the first order — and every conversion builds the attribution dataset the next phases are sold on.</p>
        </div>
        <div class="phase">
          <div class="phase-stage">Phase 2</div>
          <h4>Advertising</h4>
          <p>Sponsored looks and promoted placements, native to the feed. Because we attribute to the order, brands buy measurable ROAS instead of impressions — performance budgets at margins above affiliate take rates.</p>
        </div>
        <div class="phase">
          <div class="phase-stage">Phase 3</div>
          <h4>Direct brand partnerships</h4>
          <p>Negotiated take rates above affiliate baselines, exclusive drops, co-created creator campaigns, and managed storefronts on the partner platform we've already built. The deepest margins and the strongest moat.</p>
        </div>
      </div>
      <p class="phase-note">The financials below are built on Phase 1 economics only — advertising and direct-partnership revenue are upside on top of every figure in this document.</p>
      <p>Unit economics: revenue = impressions × conversion × order value × commission. Each acquired user is worth <b>${usd(r.ltv)}</b> against a blended CAC of <b>${usd(r.blendedCac)}</b> — <b>${r.ltvCac.toFixed(1)}×</b> LTV:CAC, paid back in <b>${r.cacPaybackMonths.toFixed(1)} months</b>, with word-of-mouth adding ${pct(a.organicGrowth)} of the base per month.</p>
    </section>
  </div>

  <!-- Sheet 2 — the business: marketing system, financials. -->
  <div class="page sheet-2">
    <section>
      <p class="kicker">05 · Marketing system</p>
      <h2>A marketing system that compounds.</h2>
      <p>Marketing is run as a system by a small, disciplined team, built on creators as the primary channel:</p>
      <div class="pillars">
        <div class="pillar"><h4>Digital Marketing</h4><p>The performance and organic engine: SEO, paid, social, lifecycle, ASO. Drives installs and sessions at a ~${usd(a.cpa)} blended CPA.</p></div>
        <div class="pillar"><h4>Business Development</h4><p>Supply and distribution: creators, brands, and affiliate networks that fill the feed — and seed the Phase 2/3 brand relationships.</p></div>
        <div class="pillar"><h4>Strategy &amp; Branding</h4><p>Positioning, brand, and measurement: why this is THE shopping app, tied back to the model.</p></div>
      </div>
      <p style="margin-top:12px">Budget deploys against weekly targets logged in a CRM; creators are paid on signups and ongoing engagement; every cycle the learnings drive CPA down.</p>
    </section>

    <section>
      <p class="kicker">06 · Financial assumptions</p>
      <h2>${d.horizonMonths}-month projection (${esc(d.scenario)} case).</h2>
      <div class="metrics">
        ${headline.map(card).join('')}
      </div>
      <table class="assumptions">
        <thead><tr><th>Assumption</th><th>Value</th><th>Why / benchmark</th></tr></thead>
        <tbody>
          ${assumptions.map(assumptionRow).join('')}
        </tbody>
      </table>
      <p class="disclaimer" style="margin-top:8px">Model projections from the assumptions above, not guarantees. Affiliate (Phase 1) revenue only.</p>
    </section>

    <section>
      <p class="kicker">07 · Use of funds</p>
      <h2>Capital to turn the flywheel on.</h2>
      <p>This plan runs on <b>${usd(c.cashRaised)}</b> of cash at an average monthly burn of <b>${usd(r.avgBurn, true)}</b> — <b>${runwayWords}</b> of runway. Capital goes into the marketing system above and the team that runs it: compounding organic growth, driving CAC down each cycle, and building the audience and conversion record that unlock the advertising and direct-partnership phases.</p>
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
