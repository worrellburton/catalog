import '~/styles/gtm.css';

// GTM — the complete marketing function as ONE animated, top-down tree:
//   Marketing → pillars (Digital / BizDev / Strategy & Branding) → groups → leaves.
// Everything fades up in cascade order; hover any node for the "why".
//
// Nodes flagged `added` are NOT in the original spec — they're the pieces
// needed to make the map genuinely 100% comprehensive, marked "suggested" so
// it's obvious what was filled in.

interface Leaf { name: string; note: string; added?: boolean }
interface Group { name: string; note: string; added?: boolean; leaves?: Leaf[] }
interface Pillar { name: string; accent: string; note: string; groups: Group[] }

const PILLARS: Pillar[] = [
  {
    name: 'Digital Marketing',
    accent: '#6366f1',
    note: 'The performance + organic engine — drives installs, sessions, and the ~$5 CPA.',
    groups: [
      {
        name: 'SEO',
        note: 'Web reach so discovery happens off-app too — every look & product page indexed.',
        leaves: [
          { name: 'Content', note: 'Editorial + programmatic pages that rank and feed the funnel.', added: true },
          { name: 'Technical SEO', note: 'Crawlable SPA, sitemaps, fast Core Web Vitals.', added: true },
        ],
      },
      {
        name: 'Campaigns',
        note: 'Owned lifecycle messaging — the cheapest retention lever we have.',
        leaves: [
          { name: 'Email', note: 'Daily-feed drops, lifecycle flows, win-back.' },
          { name: 'Text', note: 'SMS for high-intent drops & re-engagement.' },
          { name: 'Push', note: 'App notifications the moment a new daily feed drops.', added: true },
        ],
      },
      {
        name: 'Social',
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
        name: 'Paid Ads',
        note: 'Performance acquisition at ~$5 CPA — early-heavy spend, then taper to organic.',
        leaves: [
          { name: 'Google', note: 'Search + Shopping + YouTube performance.' },
          { name: 'TikTok', note: 'Performance video.' },
          { name: 'Meta', note: 'Instagram / Facebook performance + retargeting.' },
          { name: 'Apple Search Ads', note: 'High-intent app installs.', added: true },
        ],
      },
      { name: 'ASO', note: 'App Store Optimization — rank + convert installs on iOS & Android.', added: true },
      { name: 'Affiliate & referral', note: 'The ~20%/mo word-of-mouth + referral loop that compounds CAC down.', added: true },
    ],
  },
  {
    name: 'Business Development',
    accent: '#10b981',
    note: 'Supply + distribution — the brands, creators & platforms that make the feed worth opening.',
    groups: [
      { name: 'Creator', note: 'Recruit & onboard creators to publish shoppable looks at scale.' },
      { name: 'Brand', note: 'Merchant / affiliate partnerships — supply + higher commission rates.' },
      { name: 'Affiliate networks', note: 'Shopify, Impact, etc. — breadth of shoppable inventory fast.', added: true },
      { name: 'Platform & distribution', note: 'App-store features, integrations, embeds, co-marketing.', added: true },
      { name: 'PR & media', note: 'Launch + milestone press; the founder & company narrative.', added: true },
    ],
  },
  {
    name: 'Strategy & Branding',
    accent: '#f59e0b',
    note: 'Why this is THE shopping app — positioning, brand, and the measurement that ties it together.',
    groups: [
      { name: 'Positioning', note: 'One shopping app, web+app, one user base — Amazon/Pinterest/TikTok, not fashion.' },
      { name: 'Brand identity', note: 'Look, voice, and the Catalog wordmark system.' },
      { name: 'Messaging', note: 'The single narrative carried across every channel.' },
      { name: 'Market & ICP research', note: 'Who we serve, what they shop, where they already are.', added: true },
      { name: 'Community', note: 'Creators + power shoppers as an owned, compounding audience.', added: true },
      { name: 'Measurement', note: 'CPA · LTV:CPA · payback — tie every channel back to the model.', added: true },
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
        <p className="admin-page-subtitle">The complete marketing function, top-down. Hover anything for the why.</p>
      </div>

      <div className="gtm-tree">
        <section className="gtm-root gtm-fade" style={delay()}>
          <span className="gtm-root-kicker">Go-to-market · 100%</span>
          <h2 className="gtm-root-title">Marketing</h2>
          <p className="gtm-root-note">Everything that brings shoppers in and keeps them coming back — split into three pillars.</p>
        </section>

        <div className="gtm-stem gtm-fade" style={delay()} aria-hidden="true" />

        <div className="gtm-pillars">
          {PILLARS.map(p => (
            <section
              key={p.name}
              className="gtm-pillar gtm-fade"
              style={{ ...delay(), ['--accent' as string]: p.accent }}
            >
              <header className="gtm-pillar-head">
                <h3 className="gtm-pillar-name">{p.name}</h3>
                <p className="gtm-pillar-note">{p.note}</p>
              </header>
              <div className="gtm-groups">
                {p.groups.map(g => (
                  <div key={g.name} className={`gtm-group gtm-fade${g.added ? ' is-added' : ''}`} style={delay()}>
                    <div className="gtm-group-top">
                      <span className="gtm-group-name">{g.name}</span>
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
