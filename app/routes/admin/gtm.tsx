import '~/styles/gtm.css';

// GTM — the complete marketing function as ONE animated, top-down tree:
//   Marketing → pillars (Digital / BizDev / Strategy & Branding) → groups → leaves.
// Two structural layers on top of the tree:
//   • Budget % weights per pillar (sum to 100) — a split bar + per-pillar %.
//   • Funnel-stage tag per group + a legend, so coverage by stage is visible.
// Everything fades up in cascade order; hover any node for the "why".
// Nodes flagged `added` are filled-in pieces, marked "suggested".

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
    name: 'Digital Marketing',
    accent: '#6366f1',
    weight: 60,
    note: 'The performance + organic engine — drives installs, sessions, and the ~$5 CPA.',
    groups: [
      {
        name: 'SEO', stage: 'awareness',
        note: 'Web reach so discovery happens off-app too — every look & product page indexed.',
        leaves: [
          { name: 'Content', note: 'Editorial + programmatic pages that rank and feed the funnel.', added: true },
          { name: 'Technical SEO', note: 'Crawlable SPA, sitemaps, fast Core Web Vitals.', added: true },
        ],
      },
      {
        name: 'Campaigns', stage: 'retention',
        note: 'Owned lifecycle messaging — the cheapest retention lever we have.',
        leaves: [
          { name: 'Email', note: 'Daily-feed drops, lifecycle flows, win-back.' },
          { name: 'Text', note: 'SMS for high-intent drops & re-engagement.' },
          { name: 'Push', note: 'App notifications the moment a new daily feed drops.', added: true },
        ],
      },
      {
        name: 'Social', stage: 'awareness',
        note: 'Organic shoppable video, native to each platform.',
        leaves: [
          { name: 'Instagram', note: 'Reels — shoppable looks in-feed.' },
          { name: 'TikTok', note: 'Creator-led organic reach.' },
          { name: 'LinkedIn', note: 'Founder narrative + brand/creator recruiting.' },
          { name: 'Pinterest', note: 'Pure shopping/discovery intent — high relevance for us.', added: true },
          { name: 'YouTube', note: 'Shorts + long-form shoppable video.', added: true },
        ],
      },
      {
        name: 'Paid Ads', stage: 'acquisition',
        note: 'Performance acquisition at ~$5 CPA — early-heavy spend, then taper to organic.',
        leaves: [
          { name: 'Google', note: 'Search + Shopping + YouTube performance.' },
          { name: 'TikTok', note: 'Performance video.' },
          { name: 'Meta', note: 'Instagram / Facebook performance + retargeting.' },
          { name: 'Apple Search Ads', note: 'High-intent app installs.', added: true },
        ],
      },
      { name: 'ASO', stage: 'acquisition', note: 'App Store Optimization — rank + convert installs on iOS & Android.', added: true },
      { name: 'Affiliate & referral', stage: 'referral', note: 'The ~20%/mo word-of-mouth + referral loop that compounds CAC down.', added: true },
      { name: 'Web / CRO', stage: 'activation', note: 'Landing pages, onboarding & conversion-rate optimization — turn traffic into installs.', added: true },
      { name: 'Influencer marketing', stage: 'awareness', note: 'Paid influencer campaigns — distinct from organic Social and from creator recruiting in BizDev.', added: true },
    ],
  },
  {
    name: 'Business Development',
    accent: '#10b981',
    weight: 25,
    note: 'Supply + distribution — the brands, creators & platforms that make the feed worth opening.',
    groups: [
      { name: 'Creator', stage: 'awareness', note: 'Recruit & onboard creators to publish shoppable looks at scale.' },
      { name: 'Brand', stage: 'acquisition', note: 'Merchant / affiliate partnerships — supply + higher commission rates.' },
      { name: 'Affiliate networks', stage: 'acquisition', note: 'Shopify, Impact, etc. — breadth of shoppable inventory fast.', added: true },
      { name: 'Platform & distribution', stage: 'awareness', note: 'App-store features, integrations, embeds, co-marketing.', added: true },
      { name: 'PR & media', stage: 'awareness', note: 'Launch + milestone press; the founder & company narrative.', added: true },
    ],
  },
  {
    name: 'Strategy & Branding',
    accent: '#f59e0b',
    weight: 15,
    note: 'Why this is THE shopping app — positioning, brand, and the measurement that ties it together.',
    groups: [
      { name: 'Positioning', stage: 'awareness', note: 'One shopping app, web+app, one user base — Amazon/Pinterest/TikTok, not fashion.' },
      { name: 'Brand identity', stage: 'awareness', note: 'Look, voice, and the Catalog wordmark system.' },
      { name: 'Messaging', stage: 'awareness', note: 'The single narrative carried across every channel.' },
      { name: 'Market & ICP research', stage: 'awareness', note: 'Who we serve, what they shop, where they already are.', added: true },
      { name: 'Community', stage: 'retention', note: 'Creators + power shoppers as an owned, compounding audience.', added: true },
      {
        name: 'Measurement', stage: 'activation', note: 'Tie every channel back to the model so spend is accountable.', added: true,
        leaves: [
          { name: 'Attribution / MMP', note: 'AppsFlyer / Adjust + pixels — without it, no channel CPA is trustworthy.', added: true },
          { name: 'KPIs per channel', note: 'CPA · LTV:CPA · payback targets, tracked per channel.', added: true },
        ],
      },
      { name: 'Pricing & monetization', stage: 'acquisition', note: 'Commission tiers and what we charge brands — the other half of unit economics.', added: true },
      { name: 'Competitive intelligence', stage: 'awareness', note: 'Track Amazon / Pinterest / TikTok Shop + emerging shopping apps.', added: true },
      { name: 'Creative production', stage: 'awareness', note: 'The engine that makes the shoppable-video assets every channel needs.', added: true },
    ],
  },
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
  // Running index → cascading fade-in order (hero first, then down the tree).
  let order = 0;
  const delay = () => ({ animationDelay: `${order++ * 55}ms` } as React.CSSProperties);

  return (
    <div className="admin-page gtm-page">
      <div className="admin-page-header">
        <h1>GTM</h1>
        <p className="admin-page-subtitle">The complete marketing function, top-down. Budget split + funnel coverage on top of the tree. Hover anything for the why.</p>
      </div>

      <div className="gtm-tree">
        <section className="gtm-root gtm-fade" style={delay()}>
          <span className="gtm-root-kicker">Go-to-market · 100%</span>
          <h2 className="gtm-root-title">Marketing</h2>
          <p className="gtm-root-note">Everything that brings shoppers in and keeps them coming back — split into three pillars.</p>
        </section>

        {/* Budget split (sums to 100%) + funnel-stage legend. */}
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
              <span key={s.id} className="gtm-legend-item">
                <span className="gtm-dot" style={{ background: s.color }} />{s.label}
              </span>
            ))}
          </div>
        </div>

        <div className="gtm-stem gtm-fade" style={delay()} aria-hidden="true" />

        <div className="gtm-pillars">
          {PILLARS.map(p => (
            <section
              key={p.name}
              className="gtm-pillar gtm-fade"
              style={{ ...delay(), ['--accent' as string]: p.accent }}
            >
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
    </div>
  );
}
