import { useEffect, useState } from 'react';
import '~/styles/gtm.css';

// GTM — go-to-market deck. An 8-slide click-through pitch tying the
// marketing strategy to the model's projections. Pure in-component
// state; no router navigation between slides, no external libs.

const TOTAL_SLIDES = 8;

function Stat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className={`gtm-stat${accent ? ' gtm-stat-accent' : ''}`}>
      <span className="gtm-stat-value">{value}</span>
      <span className="gtm-stat-label">{label}</span>
    </div>
  );
}

function Slide1() {
  return (
    <div className="gtm-slide gtm-slide-hero">
      <span className="gtm-eyebrow">Positioning · Vision</span>
      <h2 className="gtm-headline">
        One shopping app.<br />Everything you buy, as <span className="gtm-accent-text">shoppable video.</span>
      </h2>
      <p className="gtm-lead">
        A single platform across web + iOS + Android with one unified user base —
        a broad shopping destination at the scale of Amazon, Pinterest and TikTok,
        not a fashion-only app.
      </p>
      <div className="gtm-wedge">
        <span className="gtm-wedge-label">The wedge</span>
        <p>AI-generated shoppable short-video <strong>“looks”</strong> + a personalized daily feed an Automatic Editor curates from every tap, save and shop.</p>
      </div>
    </div>
  );
}

function Slide2() {
  return (
    <div className="gtm-slide">
      <span className="gtm-eyebrow">Market · The Wedge</span>
      <h2 className="gtm-title">Broad shopping, entered through video.</h2>
      <p className="gtm-lead">
        Discovery commerce is the next decade of retail. We enter the whole shopping
        market — not one vertical — through the single feature incumbents can’t bolt on.
      </p>
      <div className="gtm-cols gtm-cols-3">
        <div className="gtm-card">
          <h3>The ambition</h3>
          <p>Amazon-scale catalog breadth, Pinterest-scale intent, TikTok-scale watch time — one app.</p>
        </div>
        <div className="gtm-card gtm-card-accent">
          <h3>The wedge</h3>
          <p>AI shoppable video + a personalized daily feed. Tap a look, see its products, shop instantly.</p>
        </div>
        <div className="gtm-card">
          <h3>Why now</h3>
          <p>AI makes shoppable video cheap to generate at catalog scale; short-video is the default discovery surface.</p>
        </div>
      </div>
    </div>
  );
}

function Slide3() {
  return (
    <div className="gtm-slide">
      <span className="gtm-eyebrow">Who We Acquire · ICP</span>
      <h2 className="gtm-title">One user base. Every device.</h2>
      <p className="gtm-lead">
        We acquire the broad online shopper — then keep them across every surface
        with one account and one personalized feed.
      </p>
      <div className="gtm-cols gtm-cols-3">
        <div className="gtm-card">
          <h3>Discovery shoppers</h3>
          <p>Browse-to-buy consumers who shop for inspiration, not a single SKU.</p>
        </div>
        <div className="gtm-card">
          <h3>Video-native buyers</h3>
          <p>Gen-Z / Millennial audiences who already shop through short video.</p>
        </div>
        <div className="gtm-card">
          <h3>Creators</h3>
          <p>Publish looks, bring their audience, earn a share of the sales they drive.</p>
        </div>
      </div>
      <div className="gtm-callout">
        <strong>Why cross-device + web matters:</strong> SEO and the open web give us
        durable, low-cost organic reach; the app deepens retention. One user base means
        a web visitor and an app user are the same compounding account.
      </div>
    </div>
  );
}

function Slide4() {
  return (
    <div className="gtm-slide">
      <span className="gtm-eyebrow">Channel Mix · The Engine</span>
      <h2 className="gtm-title">Four channels, one acquisition engine.</h2>
      <div className="gtm-cols gtm-cols-4">
        <div className="gtm-card">
          <h3>Paid performance</h3>
          <p>Performance marketing at a blended <strong>~$5 CPA</strong>. Scales the curve early.</p>
        </div>
        <div className="gtm-card gtm-card-accent">
          <h3>Organic / viral</h3>
          <p>Word-of-mouth loop adding <strong>~20% / mo</strong> in new users. Compounds late.</p>
        </div>
        <div className="gtm-card">
          <h3>Creator / affiliate</h3>
          <p>Creators distribute looks to their own audiences — acquisition that pays for itself.</p>
        </div>
        <div className="gtm-card">
          <h3>SEO / web</h3>
          <p>Indexable looks &amp; products drive durable, near-zero-cost inbound.</p>
        </div>
      </div>
      <div className="gtm-shift">
        <div className="gtm-shift-row">
          <span className="gtm-shift-label">Early (months 1–6)</span>
          <div className="gtm-bar"><span className="gtm-bar-paid" style={{ width: '70%' }}>Paid 70%</span><span className="gtm-bar-organic" style={{ width: '30%' }}>Organic 30%</span></div>
        </div>
        <div className="gtm-shift-row">
          <span className="gtm-shift-label">Late (months 11–16)</span>
          <div className="gtm-bar"><span className="gtm-bar-paid" style={{ width: '35%' }}>Paid 35%</span><span className="gtm-bar-organic" style={{ width: '65%' }}>Organic 65%</span></div>
        </div>
      </div>
    </div>
  );
}

function Slide5() {
  return (
    <div className="gtm-slide">
      <span className="gtm-eyebrow">Growth Loops · Funnel</span>
      <h2 className="gtm-title">The loop that compounds.</h2>
      <p className="gtm-lead">Every action feeds the personalized feed, which lifts retention, which fuels referral.</p>
      <div className="gtm-loop">
        <div className="gtm-loop-step"><span className="gtm-loop-num">1</span><h3>Acquire</h3><p>Paid + organic + creator + SEO</p></div>
        <span className="gtm-loop-arrow">→</span>
        <div className="gtm-loop-step"><span className="gtm-loop-num">2</span><h3>Engage</h3><p>Taps, saves, shops on looks</p></div>
        <span className="gtm-loop-arrow">→</span>
        <div className="gtm-loop-step"><span className="gtm-loop-num">3</span><h3>Personalize</h3><p>Automatic Editor builds the daily feed</p></div>
        <span className="gtm-loop-arrow">→</span>
        <div className="gtm-loop-step"><span className="gtm-loop-num">4</span><h3>Retain</h3><p>Better feed → more daily returns</p></div>
        <span className="gtm-loop-arrow">→</span>
        <div className="gtm-loop-step gtm-loop-step-accent"><span className="gtm-loop-num">5</span><h3>Refer</h3><p>~20%/mo word-of-mouth back to step 1</p></div>
      </div>
      <div className="gtm-callout">
        Each loop lowers blended CPA and raises LTV — the daily feed turns one-time
        acquisition into a recurring shopping habit.
      </div>
    </div>
  );
}

function Slide6() {
  return (
    <div className="gtm-slide">
      <span className="gtm-eyebrow">Phased Rollout · 16 Months</span>
      <h2 className="gtm-title">A credible path to scale.</h2>
      <div className="gtm-phases">
        <div className="gtm-phase">
          <span className="gtm-phase-range">Months 1–4</span>
          <h3>Seed &amp; Launch</h3>
          <p>Stand up catalog + feed, validate ~$5 CPA, seed first creators. <strong>Paid-heavy</strong> spend.</p>
        </div>
        <div className="gtm-phase gtm-phase-accent">
          <span className="gtm-phase-range">Months 5–10</span>
          <h3>Growth</h3>
          <p>Scale paid, ignite the ~20%/mo organic loop, expand creator distribution. Spend mix tilts toward organic.</p>
        </div>
        <div className="gtm-phase">
          <span className="gtm-phase-range">Months 11–16</span>
          <h3>Scale</h3>
          <p>Organic + SEO carry the curve; paid becomes optimization not fuel. <strong>Organic-led</strong> growth.</p>
        </div>
      </div>
      <div className="gtm-callout">
        Spend front-loads on paid to build the base, then shifts to the compounding
        organic loop — mapping budget to the growth curve, not against it.
      </div>
    </div>
  );
}

function Slide7() {
  return (
    <div className="gtm-slide">
      <span className="gtm-eyebrow">Unit Economics · Why It Works</span>
      <h2 className="gtm-title">The projections hold up.</h2>
      <div className="gtm-stats gtm-stats-row">
        <Stat value="$5" label="Blended CPA" accent />
        <Stat value="$60" label="AOV" />
        <Stat value="10%" label="Affiliate commission" />
        <Stat value="85%" label="Gross margin" />
      </div>
      <div className="gtm-econ">
        <div className="gtm-econ-chain">
          <span>$60 AOV</span><i>×</i><span>10% commission</span><i>=</i><span className="gtm-accent-text">$6 rev / order</span>
          <i>×</i><span>85% margin</span><i>=</i><span className="gtm-accent-text">~$5.10 contribution</span>
        </div>
        <p className="gtm-econ-note">
          With repeat purchases from the daily feed, LTV runs well above the $5 CPA —
          a healthy <strong>LTV:CPA</strong> and a fast <strong>CPA payback</strong> inside the first orders.
          No inventory means margin stays at ~85% as volume grows.
        </p>
      </div>
      <div className="gtm-stats gtm-stats-row">
        <Stat value=">1×" label="LTV : CPA" accent />
        <Stat value="Fast" label="CPA payback" />
        <Stat value="0" label="Inventory cost" />
      </div>
    </div>
  );
}

function Slide8() {
  return (
    <div className="gtm-slide">
      <span className="gtm-eyebrow">Targets · The Ask</span>
      <h2 className="gtm-title">16-month targets &amp; what it takes.</h2>
      <div className="gtm-stats gtm-stats-grid">
        <Stat value="$1.5M" label="Raised" accent />
        <Stat value="16+ mo" label="Runway" />
        <Stat value="GMV" label="Driven through the feed" />
        <Stat value="ARR" label="From affiliate commission" />
        <Stat value="Avg MAU" label="One unified user base" />
        <Stat value="~$5 CPA" label="Held blended" />
      </div>
      <div className="gtm-ask">
        <h3>What’s needed to hit them</h3>
        <ul>
          <li>Deploy the $1.5M across the front-loaded paid → organic spend shift.</li>
          <li>Hold ~$5 blended CPA while the ~20%/mo organic loop takes over.</li>
          <li>Grow creator-driven distribution to compound acquisition for free.</li>
          <li>Keep gross margin at ~85% — affiliate model, no inventory.</li>
        </ul>
      </div>
    </div>
  );
}

const SLIDES = [Slide1, Slide2, Slide3, Slide4, Slide5, Slide6, Slide7, Slide8];

export default function AdminGtm() {
  const [slide, setSlide] = useState(0);

  const go = (next: number) => setSlide(Math.max(0, Math.min(TOTAL_SLIDES - 1, next)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setSlide(s => Math.max(0, s - 1));
      else if (e.key === 'ArrowRight') setSlide(s => Math.min(TOTAL_SLIDES - 1, s + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="admin-page gtm-page">
      <div className="admin-page-header">
        <h1>GTM</h1>
        <p className="admin-page-subtitle">
          Go-to-market strategy — an 8-slide deck tying the marketing engine to the model’s projections.
        </p>
      </div>

      <div className="gtm-deck">
        <button
          className="gtm-nav gtm-nav-prev"
          onClick={() => go(slide - 1)}
          disabled={slide === 0}
          aria-label="Previous slide"
        >‹</button>

        <div className="gtm-viewport">
          <div className="gtm-track" style={{ transform: `translateX(-${slide * 100}%)` }}>
            {SLIDES.map((S, i) => (
              <div className="gtm-slide-wrap" key={i} aria-hidden={i !== slide}>
                <S />
              </div>
            ))}
          </div>
        </div>

        <button
          className="gtm-nav gtm-nav-next"
          onClick={() => go(slide + 1)}
          disabled={slide === TOTAL_SLIDES - 1}
          aria-label="Next slide"
        >›</button>
      </div>

      <div className="gtm-footer">
        <div className="gtm-dots">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              className={`gtm-dot${i === slide ? ' is-active' : ''}`}
              onClick={() => go(i)}
              aria-label={`Go to slide ${i + 1}`}
              aria-current={i === slide}
            />
          ))}
        </div>
        <span className="gtm-counter">{slide + 1} / {TOTAL_SLIDES}</span>
      </div>
    </div>
  );
}
