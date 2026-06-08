import { useEffect, useRef } from 'react';
import '~/styles/gtm.css';

// GTM — the marketing function as a connected, top-down DIAGRAM:
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
    name: 'Digital Marketing', accent: '#6366f1', weight: 60,
    note: 'The performance + organic engine — installs, sessions, and the ~$5 CPA.',
    groups: [
      { name: 'SEO', stage: 'awareness', note: 'Discovery off-app too — every look & product page indexed.', leaves: [
        { name: 'Content', note: 'Editorial + programmatic pages that rank.', added: true },
        { name: 'Technical SEO', note: 'Crawlable SPA, sitemaps, Core Web Vitals.', added: true },
      ]},
      { name: 'Campaigns', stage: 'retention', note: 'Owned lifecycle — the cheapest retention lever.', leaves: [
        { name: 'Email', note: 'Daily-feed drops, lifecycle, win-back.' },
        { name: 'Text', note: 'SMS for high-intent drops & re-engagement.' },
        { name: 'Push', note: 'Notify when a new daily feed drops.', added: true },
      ]},
      { name: 'Social', stage: 'awareness', note: 'Organic shoppable video, native to each platform.', leaves: [
        { name: 'Instagram', note: 'Reels — shoppable looks.' },
        { name: 'TikTok', note: 'Creator-led organic reach.' },
        { name: 'LinkedIn', note: 'Founder + brand/creator recruiting.' },
        { name: 'Pinterest', note: 'Shopping/discovery intent.', added: true },
        { name: 'YouTube', note: 'Shorts + long-form shoppable.', added: true },
      ]},
      { name: 'Paid Ads', stage: 'acquisition', note: 'Performance at ~$5 CPA — early-heavy, then taper.', leaves: [
        { name: 'Google', note: 'Search + Shopping + YouTube.' },
        { name: 'TikTok', note: 'Performance video.' },
        { name: 'Meta', note: 'IG/FB performance + retargeting.' },
        { name: 'Apple Search Ads', note: 'High-intent installs.', added: true },
      ]},
      { name: 'ASO', stage: 'acquisition', note: 'Rank + convert installs on iOS & Android.', added: true },
      { name: 'Affiliate & referral', stage: 'referral', note: 'The ~20%/mo word-of-mouth loop.', added: true },
      { name: 'Web / CRO', stage: 'activation', note: 'Landing, onboarding & conversion-rate optimization.', added: true },
      { name: 'Influencer marketing', stage: 'awareness', note: 'Paid campaigns — distinct from organic Social.', added: true },
    ],
  },
  {
    name: 'Business Development', accent: '#10b981', weight: 25,
    note: 'Supply + distribution — brands, creators & platforms that fill the feed.',
    groups: [
      { name: 'Creator', stage: 'awareness', note: 'Recruit & onboard creators to publish looks at scale.' },
      { name: 'Brand', stage: 'acquisition', note: 'Merchant / affiliate partnerships — supply + commission.' },
      { name: 'Affiliate networks', stage: 'acquisition', note: 'Shopify, Impact, etc. — breadth fast.', added: true },
      { name: 'Platform & distribution', stage: 'awareness', note: 'App-store features, integrations, embeds.', added: true },
      { name: 'PR & media', stage: 'awareness', note: 'Launch + milestone press; the narrative.', added: true },
    ],
  },
  {
    name: 'Strategy & Branding', accent: '#f59e0b', weight: 15,
    note: 'Why this is THE shopping app — positioning, brand & measurement.',
    groups: [
      { name: 'Positioning', stage: 'awareness', note: 'One shopping app, web+app, one user base — not fashion.' },
      { name: 'Brand identity', stage: 'awareness', note: 'Look, voice, the Catalog wordmark system.' },
      { name: 'Messaging', stage: 'awareness', note: 'One narrative across every channel.' },
      { name: 'Market & ICP research', stage: 'awareness', note: 'Who we serve and what they shop.', added: true },
      { name: 'Community', stage: 'retention', note: 'Creators + power shoppers as an owned audience.', added: true },
      { name: 'Measurement', stage: 'activation', note: 'Tie every channel back to the model.', added: true, leaves: [
        { name: 'Attribution / MMP', note: 'AppsFlyer / Adjust + pixels.', added: true },
        { name: 'KPIs per channel', note: 'CPA · LTV:CPA · payback.', added: true },
      ]},
      { name: 'Pricing & monetization', stage: 'acquisition', note: 'Commission tiers — the other half of unit economics.', added: true },
      { name: 'Competitive intelligence', stage: 'awareness', note: 'Track Amazon / Pinterest / TikTok Shop.', added: true },
      { name: 'Creative production', stage: 'awareness', note: 'The engine that makes the shoppable-video assets.', added: true },
    ],
  },
];

const FLYWHEEL: { tag: string; title: string; body: string; accent: string }[] = [
  { tag: 'The goal', title: 'Start the flywheel.', body: 'Stand up a marketing engine that compounds — so growth stops depending on any one person.', accent: '#6366f1' },
  { tag: 'Step 1 · Hire', title: 'Bring on the team.', body: 'Three BD / marketing consultants, month-to-month for three months. Some may convert to full-time — the point is to start delegating the system now; it can’t run on one person.', accent: '#8b5cf6' },
  { tag: 'Step 2 · Be diligent', title: 'Log every contact.', body: 'Every outreach goes in the CRM. People are measured on contact attempts per week — an intentional, serious, sustained push.', accent: '#10b981' },
  { tag: 'Step 3 · Learn & repeat', title: 'Double down on what works.', body: 'Lean into what’s working, step away from what isn’t, and repeat. The loop tightens every cycle.', accent: '#f59e0b' },
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

  // Scroll-reveal the flywheel slides one at a time.
  const flywheelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = flywheelRef.current;
    if (!root) return;
    const slides = Array.from(root.querySelectorAll('.gtm-fly-slide'));
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('is-in'); });
    }, { threshold: 0.35 });
    slides.forEach(s => io.observe(s));
    return () => io.disconnect();
  }, []);

  // Enable full-page scroll snapping on the flywheel slides — scoped to this
  // page by toggling a class on <html>, removed on unmount so it never
  // affects the other admin screens.
  useEffect(() => {
    document.documentElement.classList.add('gtm-snap');
    return () => document.documentElement.classList.remove('gtm-snap');
  }, []);

  return (
    <div className="admin-page gtm-page">
      <div className="admin-page-header">
        <h1>GTM</h1>
        <p className="admin-page-subtitle">The marketing function as a connected diagram — and the plan to put it in motion. Hover any node for the why.</p>
      </div>

      <div className="gtm-tree">
        {/* Tier 0 */}
        <section className="gtm-root gtm-fade" style={delay()}>
          <span className="gtm-root-kicker">Go-to-market · 100%</span>
          <h2 className="gtm-root-title">Marketing</h2>
          <p className="gtm-root-note">Everything that brings shoppers in and keeps them coming back — split into three pillars.</p>
        </section>

        <div className="gtm-meta gtm-fade" style={delay()}>
          <div className="gtm-split" role="img" aria-label="Marketing budget split across the three pillars">
            {PILLARS.map(p => (
              <div key={p.name} className="gtm-split-seg" style={{ flexGrow: p.weight, background: p.accent }}>
                <span className="gtm-split-pct">{p.weight}%</span>
                <span className="gtm-split-name">{p.name}</span>
              </div>
            ))}
          </div>
          <div className="gtm-legend">
            <span className="gtm-legend-label">Funnel coverage</span>
            {STAGES.map(s => (
              <span key={s.id} className="gtm-legend-item"><span className="gtm-dot" style={{ background: s.color }} />{s.label}</span>
            ))}
          </div>
        </div>

        <div className="gtm-stem gtm-fade" style={delay()} aria-hidden="true" />

        {/* Tier 1 → 3: pillars, each a connected branch (spine + ticks). */}
        <div className="gtm-pillars">
          {PILLARS.map(p => (
            <section key={p.name} className="gtm-pillar gtm-fade" style={{ ...delay(), ['--accent' as string]: p.accent }}>
              <header className="gtm-pillar-head">
                <div className="gtm-pillar-titlerow">
                  <h3 className="gtm-pillar-name">{p.name}</h3>
                  <span className="gtm-pillar-weight" title="Share of marketing budget / effort">{p.weight}%</span>
                </div>
                <p className="gtm-pillar-note">{p.note}</p>
              </header>
              <div className="gtm-groups">
                {p.groups.map(g => (
                  <div key={g.name} className={`gtm-group gtm-fade${g.added ? ' is-added' : ''}`} style={delay()}>
                    <div className="gtm-group-top">
                      <span className="gtm-group-name">{g.name}</span>
                      <span className="gtm-stage" title={`Primary funnel stage: ${STAGE[g.stage].label}`}>
                        <span className="gtm-dot" style={{ background: STAGE[g.stage].color }} />{STAGE[g.stage].label}
                      </span>
                      {g.added && <span className="gtm-suggested" title="Suggested — added to make the map comprehensive">suggested</span>}
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

      {/* Flywheel — the plan to put the map in motion, as a deck of
          full-viewport slides that snap one at a time. */}
      <div className="gtm-flywheel" ref={flywheelRef}>
        {FLYWHEEL.map((s, i) => (
          <section
            key={s.tag}
            className="gtm-fly-slide"
            style={{ ['--accent' as string]: s.accent }}
          >
            <span className="gtm-fly-watermark" aria-hidden="true">{i + 1}</span>
            <div className="gtm-fly-inner">
              <span className="gtm-fly-index" aria-hidden="true">
                {String(i + 1).padStart(2, '0')} <span className="gtm-fly-index-total">/ {String(FLYWHEEL.length).padStart(2, '0')}</span>
              </span>
              <span className="gtm-fly-tag">{s.tag}</span>
              <h3 className="gtm-fly-title">{s.title}</h3>
              <p className="gtm-fly-body">{s.body}</p>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
