import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import '~/styles/gtm.css';

// GTM - the marketing function as a connected, top-down DIAGRAM:
//   Marketing → pillars → groups → leaves, joined by connector spines so each
//   node visibly points to its children. Budget % split + a funnel-stage tag
//   sit on top. Below the diagram, a scroll-revealed "flywheel" lays out the
//   plan to put it in motion. Reveal is opacity-only (no transform) so nodes
//   can never overlap mid-animation.

type StageId = 'awareness' | 'acquisition' | 'activation' | 'retention' | 'referral';
interface Stage { id: StageId; label: string; color: string }
const STAGES: Stage[] = [
  { id: 'awareness',   label: 'Awareness',   color: '#8b5cf6' },
  { id: 'acquisition', label: 'Acquisition', color: '#3b82f6' },
  { id: 'activation',  label: 'Activation',  color: '#06b6d4' },
  { id: 'retention',   label: 'Retention',   color: '#10b981' },
  { id: 'referral',    label: 'Referral',    color: '#f59e0b' },
];
const STAGE = Object.fromEntries(STAGES.map(s => [s.id, s])) as Record<StageId, Stage>;

interface Leaf { name: string; note: string; added?: boolean }
interface Group { name: string; note: string; stage: StageId; added?: boolean; leaves?: Leaf[] }
interface Pillar { name: string; accent: string; weight: number; note: string; groups: Group[] }

const PILLARS: Pillar[] = [
  {
    name: 'Digital Marketing', accent: '#6366f1', weight: 1,
    note: 'The performance + organic engine - installs, sessions, and the ~$5 CPA.',
    groups: [
      { name: 'SEO', stage: 'awareness', note: 'Discovery off-app too - every look & product page indexed.', leaves: [
        { name: 'Content', note: 'Editorial + programmatic pages that rank.', added: true },
        { name: 'Technical SEO', note: 'Crawlable SPA, sitemaps, Core Web Vitals.', added: true },
      ]},
      { name: 'Campaigns', stage: 'retention', note: 'Owned lifecycle - the cheapest retention lever.', leaves: [
        { name: 'Email', note: 'Daily-feed drops, lifecycle, win-back.' },
        { name: 'Text', note: 'SMS for high-intent drops & re-engagement.' },
        { name: 'Push', note: 'Notify when a new daily feed drops.', added: true },
      ]},
      { name: 'Social', stage: 'awareness', note: 'Organic shoppable video, native to each platform.', leaves: [
        { name: 'Instagram', note: 'Reels - shoppable looks.' },
        { name: 'TikTok', note: 'Creator-led organic reach.' },
        { name: 'LinkedIn', note: 'Founder + brand/creator recruiting.' },
        { name: 'Pinterest', note: 'Shopping/discovery intent.', added: true },
        { name: 'YouTube', note: 'Shorts + long-form shoppable.', added: true },
      ]},
      { name: 'Paid Ads', stage: 'acquisition', note: 'Performance at ~$5 CPA - early-heavy, then taper.', leaves: [
        { name: 'Google', note: 'Search + Shopping + YouTube.' },
        { name: 'TikTok', note: 'Performance video.' },
        { name: 'Meta', note: 'IG/FB performance + retargeting.' },
        { name: 'Apple Search Ads', note: 'High-intent installs.', added: true },
      ]},
      { name: 'ASO', stage: 'acquisition', note: 'Rank + convert installs on iOS & Android.', added: true },
      { name: 'Affiliate & referral', stage: 'referral', note: 'The ~20%/mo word-of-mouth loop.', added: true },
      { name: 'Web / CRO', stage: 'activation', note: 'Landing, onboarding & conversion-rate optimization.', added: true },
      { name: 'Influencer marketing', stage: 'awareness', note: 'Paid campaigns - distinct from organic Social.', added: true },
    ],
  },
  {
    name: 'Business Development', accent: '#10b981', weight: 1,
    note: 'Supply + distribution - brands, creators & platforms that fill the feed.',
    groups: [
      { name: 'Creator', stage: 'awareness', note: 'Recruit & onboard creators to publish looks at scale.' },
      { name: 'Brand', stage: 'acquisition', note: 'Merchant / affiliate partnerships - supply + commission.' },
      { name: 'Affiliate networks', stage: 'acquisition', note: 'Shopify, Impact, etc. - breadth fast.', added: true },
      { name: 'Platform & distribution', stage: 'awareness', note: 'App-store features, integrations, embeds.', added: true },
      { name: 'PR & media', stage: 'awareness', note: 'Launch + milestone press; the narrative.', added: true },
    ],
  },
  {
    name: 'Strategy & Branding', accent: '#f59e0b', weight: 1,
    note: 'Why this is THE shopping app - positioning, brand & measurement.',
    groups: [
      { name: 'Positioning', stage: 'awareness', note: 'One shopping app, web+app, one user base - not fashion.' },
      { name: 'Brand identity', stage: 'awareness', note: 'Look, voice, the Catalog wordmark system.' },
      { name: 'Messaging', stage: 'awareness', note: 'One narrative across every channel.' },
      { name: 'Market & ICP research', stage: 'awareness', note: 'Who we serve and what they shop.', added: true },
      { name: 'Community', stage: 'retention', note: 'Creators + power shoppers as an owned audience.', added: true },
      { name: 'Measurement', stage: 'activation', note: 'Tie every channel back to the model.', added: true, leaves: [
        { name: 'Attribution / MMP', note: 'AppsFlyer / Adjust + pixels.', added: true },
        { name: 'KPIs per channel', note: 'CPA · LTV:CPA · payback.', added: true },
      ]},
      { name: 'Pricing & monetization', stage: 'acquisition', note: 'Commission tiers - the other half of unit economics.', added: true },
      { name: 'Competitive intelligence', stage: 'awareness', note: 'Track Amazon / Pinterest / TikTok Shop.', added: true },
      { name: 'Creative production', stage: 'awareness', note: 'The engine that makes the shoppable-video assets.', added: true },
    ],
  },
];

const FLYWHEEL: { kicker: string; title: string; body: string; accent: string }[] = [
  { kicker: 'The goal', title: 'Turn the flywheel on.', body: 'Create a marketing engine that compounds on its own.', accent: '#6366f1' },
  { kicker: 'Step 1', title: 'Hire.', body: 'Three BD / marketing consultants, month-to-month for three months. Some may convert to full-time - the point is to start delegating the system now; it can’t run on one person.', accent: '#8b5cf6' },
  { kicker: 'Step 2 · Strategy', title: 'Market through creators.', body: 'The three consultants specialize in creator relations - starting small and scaling. Creators are our primary advertising channel: we partner with them to post, build catalogs, and share on their socials, and pay them on every signup plus ongoing engagement.', accent: '#ec4899' },
  { kicker: 'Step 3', title: 'Deploy budget effectively.', body: 'Run a disciplined, mission-driven team that logs every contact in the CRM, holds each other to weekly targets, and moves as one synergistic unit with real purpose: putting every marketing dollar to work as effectively as possible, laser-focused on driving the CPA down.', accent: '#10b981' },
  { kicker: 'Step 4', title: 'Learn & repeat.', body: 'Continuous improvement on strategy, campaign management, and creator management - lean into what’s working, cut what isn’t, and tighten the loop every cycle. The goal: drive CPA as low as possible.', accent: '#f59e0b' },
];

function Leaves({ leaves }: { leaves: Leaf[] }) {
  return (
    <div className="gtm-leaves">
      {leaves.map(l => (
        <span key={l.name} className={`gtm-leaf${l.added ? ' is-added' : ''}`} tabIndex={0}>
          {l.name}
          <span className="gtm-tip" role="tooltip">{l.note}</span>
        </span>
      ))}
    </div>
  );
}

export default function AdminGtm() {
  let order = 0;
  const delay = () => ({ animationDelay: `${order++ * 45}ms` } as React.CSSProperties);

  // Branded background videos served from /public (same clips the decks use).
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

  // True whenever a flywheel slide is on screen - fades the branded video
  // backdrop in only while the deck section is in view (clean tree above).
  const [flyActive, setFlyActive] = useState(false);

  // Scroll-reveal the flywheel slides one at a time + drive the backdrop.
  const flywheelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = flywheelRef.current;
    if (!root) return;
    const slides = Array.from(root.querySelectorAll('.gtm-fly-slide'));
    const onScreen = new Set<Element>();
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('is-in'); onScreen.add(e.target); }
        else onScreen.delete(e.target);
      });
      setFlyActive(onScreen.size > 0);
    }, { threshold: 0.35 });
    slides.forEach(s => io.observe(s));
    return () => io.disconnect();
  }, []);

  // Enable full-page scroll snapping on the flywheel slides - scoped to this
  // page by toggling a class on <html>, removed on unmount so it never
  // affects the other admin screens.
  useEffect(() => {
    document.documentElement.classList.add('gtm-snap');
    return () => document.documentElement.classList.remove('gtm-snap');
  }, []);

  // ── Elbow connectors: budget segment → its pillar column ────────────
  // The 60/25/15 split segments and the equal-thirds pillar columns have
  // different centers, so a measured SVG draws an elbow (down · across ·
  // down) from each segment to the pillar it funds. Recomputed on resize
  // and once the fade-in settles so the lines always track the real
  // rendered layout.
  const chartRef = useRef<HTMLDivElement | null>(null);
  const segRefs = useRef<(HTMLDivElement | null)[]>([]);
  const pillarRefs = useRef<(HTMLElement | null)[]>([]);
  const [connectors, setConnectors] = useState<{ d: string; accent: string }[]>([]);
  const [chartSize, setChartSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const compute = () => {
      const chart = chartRef.current;
      if (!chart) return;
      const cr = chart.getBoundingClientRect();
      const next: { d: string; accent: string }[] = [];
      for (let i = 0; i < PILLARS.length; i++) {
        const seg = segRefs.current[i];
        const pil = pillarRefs.current[i];
        if (!seg || !pil) continue;
        const sr = seg.getBoundingClientRect();
        const pr = pil.getBoundingClientRect();
        const x1 = sr.left + sr.width / 2 - cr.left;
        const y1 = sr.bottom - cr.top;
        const x2 = pr.left + pr.width / 2 - cr.left;
        const y2 = pr.top - cr.top;
        const midY = (y1 + y2) / 2;
        // Rounded elbows: vertical down, quarter-arc into the horizontal
        // run, then quarter-arc back to vertical down into the pillar.
        const r = Math.min(10, Math.abs(x2 - x1) / 2, (y2 - y1) / 2);
        const dir = x2 > x1 ? 1 : -1;
        const d = r > 1
          ? `M ${x1} ${y1} V ${midY - r} Q ${x1} ${midY} ${x1 + dir * r} ${midY} H ${x2 - dir * r} Q ${x2} ${midY} ${x2} ${midY + r} V ${y2}`
          : `M ${x1} ${y1} V ${midY} H ${x2} V ${y2}`;
        next.push({ d, accent: PILLARS[i].accent });
      }
      setConnectors(next);
      setChartSize({ w: cr.width, h: cr.height });
    };
    compute();
    window.addEventListener('resize', compute);
    // Recompute once the cascade fade-in has settled (positions are stable
    // by then - opacity-only animation doesn't move anything, but fonts /
    // images loading can nudge heights).
    const t = window.setTimeout(compute, 750);
    return () => { window.removeEventListener('resize', compute); window.clearTimeout(t); };
  }, []);

  return (
    <div className="admin-page gtm-page">
      <div className="admin-page-header">
        <h1>GTM</h1>
        <p className="admin-page-subtitle">The marketing function as a connected diagram - and the plan to put it in motion. Hover any node for the why.</p>
      </div>

      <div className="gtm-tree">
        {/* Tier 0 */}
        <section className="gtm-root gtm-fade" style={delay()}>
          <span className="gtm-root-kicker">Go-to-market · 100%</span>
          <h2 className="gtm-root-title">Marketing</h2>
          <p className="gtm-root-note">Everything that brings shoppers in and keeps them coming back - split into three pillars.</p>
        </section>

        {/* Funnel legend sits under the root; the budget split moves into
            the chart below so it shares the pillars' coordinate space. */}
        <div className="gtm-legend gtm-fade" style={delay()}>
          <span className="gtm-legend-label">Funnel coverage</span>
          {STAGES.map(s => (
            <span key={s.id} className="gtm-legend-item"><span className="gtm-dot" style={{ background: s.color }} />{s.label}</span>
          ))}
        </div>

        <div className="gtm-stem gtm-fade" style={delay()} aria-hidden="true" />

        {/* Chart: full-width budget bar → elbow connectors → pillar columns.
            The split bar and the pillars share this wrapper's coordinate
            space so each 60/25/15 segment connects to the pillar it funds. */}
        <div className="gtm-chart" ref={chartRef}>
          {chartSize.w > 0 && (
            <svg
              className="gtm-connectors"
              width={chartSize.w}
              height={chartSize.h}
              viewBox={`0 0 ${chartSize.w} ${chartSize.h}`}
              aria-hidden="true"
            >
              {connectors.map((c, i) => (
                <path key={i} d={c.d} fill="none" stroke={c.accent} strokeWidth={2} strokeOpacity={0.6} strokeLinecap="round" strokeLinejoin="round" />
              ))}
            </svg>
          )}

          <div className="gtm-split gtm-fade" style={delay()} role="img" aria-label="Marketing budget split across the three pillars">
            {PILLARS.map((p, i) => (
              <div
                key={p.name}
                ref={el => { segRefs.current[i] = el; }}
                className="gtm-split-seg"
                style={{ flexGrow: p.weight, background: p.accent }}
              >
                <span className="gtm-split-name">{p.name}</span>
              </div>
            ))}
          </div>

          {/* Elbow room - the connector SVG draws through this gap. */}
          <div className="gtm-connector-gap" aria-hidden="true" />

          {/* Tier 1 → 3: pillars, each a connected branch (spine + ticks). */}
          <div className="gtm-pillars">
          {PILLARS.map((p, i) => (
            <section key={p.name} ref={el => { pillarRefs.current[i] = el; }} className="gtm-pillar gtm-fade" style={{ ...delay(), ['--accent' as string]: p.accent }}>
              {/* Plain div, NOT <header> — a global `header { position: fixed }`
                  rule in header.css (the consumer app title bar) hijacks any
                  <header> tag and pinned this pillar head full-width at the top
                  of the page. */}
              <div className="gtm-pillar-head">
                <div className="gtm-pillar-titlerow">
                  <h3 className="gtm-pillar-name">{p.name}</h3>
                </div>
                <p className="gtm-pillar-note">{p.note}</p>
              </div>
              <div className="gtm-groups">
                {p.groups.map(g => (
                  <div key={g.name} className={`gtm-group gtm-fade${g.added ? ' is-added' : ''}`} style={delay()}>
                    <div className="gtm-group-top">
                      <span className="gtm-group-name">{g.name}</span>
                      <span className="gtm-stage" title={`Primary funnel stage: ${STAGE[g.stage].label}`}>
                        <span className="gtm-dot" style={{ background: STAGE[g.stage].color }} />{STAGE[g.stage].label}
                      </span>
                      {g.added && <span className="gtm-suggested" title="Suggested - added to make the map comprehensive">suggested</span>}
                    </div>
                    <p className="gtm-group-note">{g.note}</p>
                    {g.leaves && g.leaves.length > 0 && <Leaves leaves={g.leaves} />}
                  </div>
                ))}
              </div>
            </section>
          ))}
          </div>
        </div>
      </div>

      {/* Flywheel - the plan to put the map in motion, as a deck of
          full-viewport slides that snap one at a time. Catalog-branded:
          a drifting grid of look videos sits behind a white scrim (the same
          backdrop the investor decks use, inverted to light). */}
      <div className={`gtm-flywheel${flyActive ? ' is-active' : ''}`} ref={flywheelRef}>
        <div className="gtm-fly-bg" aria-hidden="true">
          <div className="gtm-fly-bg-grid">
            {Array.from({ length: 16 }).map((_, i) => (
              <video
                key={i}
                src={`${basePath}/${i % 2 === 0 ? 'girl2.mp4' : 'guy.mp4'}`}
                muted
                loop
                playsInline
                autoPlay
                className="gtm-fly-bg-video"
              />
            ))}
          </div>
          <div className="gtm-fly-bg-overlay" />
        </div>
        {FLYWHEEL.map((s, i) => (
          <section
            key={s.kicker}
            className="gtm-fly-slide"
            style={{ ['--accent' as string]: s.accent }}
          >
            <span className="gtm-fly-watermark" aria-hidden="true">{i + 1}</span>
            <div className="gtm-fly-inner">
              <span className="gtm-fly-index" aria-hidden="true">
                {/* Zero-indexed: the goal is page 00, the steps run 01–04. */}
                {String(i).padStart(2, '0')} <span className="gtm-fly-index-total">/ {String(FLYWHEEL.length - 1).padStart(2, '0')}</span>
              </span>
              <span className="gtm-fly-tag">{s.kicker}</span>
              <h3 className="gtm-fly-title">{s.title}</h3>
              <p className="gtm-fly-body">{s.body}</p>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
