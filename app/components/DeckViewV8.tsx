
import React, { useEffect, useRef } from 'react';
import CatalogLogo from './CatalogLogo';

interface DeckViewV8Props {
  onSeeApp: () => void;
  onVisitWebsite: () => void;
  onBack: () => void;
  isLightMode: boolean;
  onToggleTheme: () => void;
}

const DeckViewV8: React.FC<DeckViewV8Props> = ({
  onSeeApp,
  onVisitWebsite,
  onBack,
  isLightMode,
  onToggleTheme,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const slides = container.querySelectorAll('.deck-slide');

    const hash = window.location.hash.replace('#', '');
    const slideMatch = hash.match(/^deck\/v8\/(\d+)$/);
    if (slideMatch) {
      const idx = parseInt(slideMatch[1], 10) - 1;
      if (idx >= 0 && idx < slides.length) {
        slides[idx].scrollIntoView();
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            const idx = Array.from(slides).indexOf(entry.target);
            if (idx >= 0) {
              window.history.replaceState(null, '', `#deck/v8/${idx + 1}`);
            }
          } else {
            entry.target.classList.remove('visible');
          }
        });
      },
      {
        root: container,
        threshold: 0.5,
      }
    );

    slides.forEach((slide) => observer.observe(slide));

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div className="deck-view deck-view-v8 active" ref={containerRef}>
      <div className="deck-v8-bg" aria-hidden="true">
        <div className="deck-insight-grid">
          {Array.from({ length: 24 }).map((_, i) => (
            <video
              key={i}
              src={`${basePath}/${i % 2 === 0 ? 'girl2.mp4' : 'guy.mp4'}`}
              muted
              loop
              playsInline
              autoPlay
              className="deck-insight-video"
            />
          ))}
        </div>
        <div className="deck-insight-overlay" />
      </div>
      <button className="deck-back-btn" onClick={onBack} aria-label="Back to decks">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
      <button className="deck-theme-toggle" onClick={onToggleTheme}>
        {isLightMode ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
        )}
      </button>

      {/* Slide 1: Cover */}
      <div className="deck-slide deck-cover">
        <CatalogLogo className="deck-logo" />
        <p className="deck-subtitle">Investor Deck V.8 for Alex and Dan</p>
      </div>

      {/* Slide 2: Intro — catalog nostalgia + SVG animations */}
      <div className="deck-slide deck-slide-intro">
        <div className="deck-intro-svgs" aria-hidden="true">
          {/* Animated floating catalog/book icons */}
          <svg className="deck-intro-icon deck-intro-icon-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
          <svg className="deck-intro-icon deck-intro-icon-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" /></svg>
          <svg className="deck-intro-icon deck-intro-icon-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>
          <svg className="deck-intro-icon deck-intro-icon-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></svg>
          <svg className="deck-intro-icon deck-intro-icon-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>
          <svg className="deck-intro-icon deck-intro-icon-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
        </div>
        <div className="deck-intro-content">
          <span className="deck-label">Intro</span>
          <h2>Shopping used to be an experience.</h2>
          <p>Flipping through a catalog was discovery at its best. Curated, visual, personal. You didn&apos;t search for what you needed — you found what you didn&apos;t know you wanted. That feeling disappeared when commerce moved online. Catalog brings it back: a platform where every creator&apos;s taste becomes a shoppable storefront, powered by AI infrastructure and built for how people actually shop today.</p>
        </div>
      </div>

      {/* Slide 3: The Problem — with animated SVG icons */}
      <div className="deck-slide">
        <span className="deck-label">The Problem</span>
        <h2>Three stakeholders.<br />Three broken experiences.</h2>
        <div className="deck-steps">
          <div className="deck-step">
            <svg className="deck-step-icon deck-anim-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <span className="deck-step-num">01</span>
            <h3>Shoppers</h3>
            <p>Discovery is fragmented across social feeds, search engines, and retail sites. The experience is ad-heavy, algorithm-driven, and impersonal. Finding products you actually want feels like work.</p>
          </div>
          <div className="deck-step">
            <svg className="deck-step-icon deck-anim-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            <span className="deck-step-num">02</span>
            <h3>Creators</h3>
            <p>Monetization is constrained by traditional affiliate structures that pay single-digit commissions and offer zero audience ownership. Creators drive purchases but don&apos;t capture the value they create.</p>
          </div>
          <div className="deck-step">
            <svg className="deck-step-icon deck-anim-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            <span className="deck-step-num">03</span>
            <h3>Brands</h3>
            <p>Creator-driven commerce is difficult to measure and hard to attribute cleanly. Brands want commerce outcomes, not just impressions, but current tools make ROI opaque.</p>
          </div>
        </div>
      </div>

      {/* Slide 4: The Insight */}
      <div className="deck-slide">
        <div className="deck-insight-content">
          <span className="deck-label">The Insight</span>
          <h2>Human taste, amplified by AI.</h2>
          <p>Creators drive purchases but can&apos;t capture the value — and have no real revenue stream from curation. Nobody has built the platform that turns taste into a storefront and uses AI to make it smarter. Visual similarity, automated tagging, personalized discovery. AI does the heavy lifting; creators earn from every sale.</p>
        </div>
      </div>

      {/* Slide 5: The Solution — three phones */}
      <div className="deck-slide deck-slide-solution">
        <div className="deck-solution-layout">
          <div className="deck-solution-text">
            <span className="deck-label">The Solution</span>
            <h2>Where discovery becomes commerce.</h2>
            <p>Shoppers browse curated looks and tap to find visually similar products. Creators build shoppable storefronts powered by their taste. Brands get measurable, creator-driven distribution. One platform connecting all three — with AI surfacing the right content to the right person.</p>
          </div>
          <div className="deck-solution-phones">
            <div className="deck-app-frame deck-phone-side">
              <video src={`${basePath}/girl2.mp4`} autoPlay loop muted playsInline className="deck-app-video" />
            </div>
            <div className="deck-app-frame deck-phone-center">
              <video src={`${basePath}/Untitled.mp4`} autoPlay loop muted playsInline className="deck-app-video" />
            </div>
            <div className="deck-app-frame deck-phone-side">
              <video src={`${basePath}/guy.mp4`} autoPlay loop muted playsInline className="deck-app-video" />
            </div>
          </div>
        </div>
      </div>

      {/* Slide 6: Three-Sided Value */}
      <div className="deck-slide">
        <span className="deck-label">Three-Sided Value</span>
        <h2>Everyone wins.</h2>
        <div className="deck-steps">
          <div className="deck-step">
            <svg className="deck-step-icon deck-anim-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><path d="M8 11h6"/><path d="M11 8v6"/></svg>
            <span className="deck-step-num">01</span>
            <h3>For Shoppers</h3>
            <p>An exploratory, curated shopping experience driven by people they trust. No algorithmic noise, no ad fatigue. Discovery that actually feels like discovery.</p>
          </div>
          <div className="deck-step">
            <svg className="deck-step-icon deck-anim-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            <span className="deck-step-num">02</span>
            <h3>For Creators</h3>
            <p>A new income stream with higher commissions, real audience ownership, and a dedicated storefront for their taste. Style becomes a durable, monetizable asset.</p>
          </div>
          <div className="deck-step">
            <svg className="deck-step-icon deck-anim-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            <span className="deck-step-num">03</span>
            <h3>For Brands</h3>
            <p>Authentic distribution through trusted voices with measurable commerce outcomes. Guaranteed ROAS visibility and clean attribution on every dollar spent.</p>
          </div>
        </div>
      </div>

      {/* Slide 7: Market Opportunity */}
      <div className="deck-slide">
        <span className="deck-label">Market Opportunity</span>
        <h2>Positioned at the intersection.</h2>
        <div className="deck-stats">
          <div className="deck-stat">
            <span className="deck-stat-num">$1.2T</span>
            <span className="deck-stat-label">Global social commerce by 2028</span>
            <div className="stat-growth">
              <div className="growth-line" style={{ '--grow-width': '85%' } as React.CSSProperties} />
              <span className="growth-rate">+31% CAGR</span>
            </div>
          </div>
          <div className="deck-stat">
            <span className="deck-stat-num">$250B</span>
            <span className="deck-stat-label">Creator-driven commerce</span>
            <div className="stat-growth">
              <div className="growth-line" style={{ '--grow-width': '65%' } as React.CSSProperties} />
              <span className="growth-rate">+22% CAGR</span>
            </div>
          </div>
          <div className="deck-stat">
            <span className="deck-stat-num">82%</span>
            <span className="deck-stat-label">Shoppers trust creator recs over ads</span>
            <div className="stat-growth">
              <div className="growth-line" style={{ '--grow-width': '50%' } as React.CSSProperties} />
              <span className="growth-rate">+12% YoY</span>
            </div>
          </div>
        </div>
        <p className="deck-note">Catalog sits where creator economy infrastructure meets social commerce. Not competing with Shopify for merchants or Instagram for attention. Building the commerce layer that connects creators directly to purchase.</p>
      </div>

      {/* Slide 8: The Math */}
      <div className="deck-slide">
        <span className="deck-label">The Math</span>
        <h2>Structurally better economics.</h2>
        <p className="deck-note deck-math-intro">A creator posts a look featuring a $200 jacket. A shopper buys it through Catalog.</p>
        <table className="math-tbl">
          <thead>
            <tr>
              <th className="math-tbl-label"></th>
              <th className="math-tbl-old">Traditional Affiliate</th>
              <th className="math-tbl-new">Catalog (Fixed ROAS)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="math-tbl-label">Brand pays</td>
              <td className="math-val-old">$20<span className="math-pct">(10%)</span></td>
              <td className="math-val-new">$40<span className="math-pct">(20%)</span></td>
            </tr>
            <tr>
              <td className="math-tbl-label">Creator payout</td>
              <td className="math-val-old">$16<span className="math-pct">(8%)</span></td>
              <td className="math-val-new">$20<span className="math-pct">(10%)</span></td>
            </tr>
            <tr>
              <td className="math-tbl-label">Platform revenue</td>
              <td className="math-val-old">$4<span className="math-pct">(2%)</span></td>
              <td className="math-val-new">$20<span className="math-pct">(10%)</span></td>
            </tr>
            <tr>
              <td className="math-tbl-label">Brand cost visibility</td>
              <td className="math-val-dim">Unpredictable</td>
              <td className="math-val-new"><span className="fire-text">Guaranteed 5x ROAS</span></td>
            </tr>
            <tr>
              <td className="math-tbl-label">Attribution</td>
              <td className="math-val-dim">Last-click, lossy</td>
              <td className="math-val-new">Full-funnel, per-creator</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Slide 9: Flywheel */}
      <div className="deck-slide deck-slide-flywheel-split">
        <div className="flywheel-left">
          <span className="deck-label">Flywheel</span>
          <h2>Build supply first.<br />Demand follows trust.</h2>
          <div className="flywheel-labels">
            <div className="flywheel-label-item"><span className="fl-num">1</span><p>Seed creators, build supply</p></div>
            <div className="flywheel-label-item"><span className="fl-num">2</span><p>Creators share, audiences arrive</p></div>
            <div className="flywheel-label-item"><span className="fl-num">3</span><p>Shoppers browse, trust, buy</p></div>
            <div className="flywheel-label-item"><span className="fl-num">4</span><p>Creators earn, invest more</p></div>
            <div className="flywheel-label-item"><span className="fl-num">5</span><p>Shoppers become creators</p></div>
          </div>
          <p>We start with creators because supply drives organic demand. Every creator who publishes a look brings their own audience, their own trust, and their own distribution.</p>
        </div>
        <div className="flywheel-right">
          <div className="flywheel-center">
            <svg className="flywheel-circle-svg" viewBox="0 0 300 300">
              <circle cx="150" cy="150" r="130" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="2" />
              <circle className="flywheel-orbit" cx="150" cy="150" r="130" fill="none" stroke="rgba(74,222,128,0.3)" strokeWidth="2" strokeDasharray="817" strokeDashoffset="817" strokeLinecap="round" />
            </svg>
            <div className="flywheel-node" style={{ '--angle': '0deg' } as React.CSSProperties}><span>1</span></div>
            <div className="flywheel-node" style={{ '--angle': '72deg' } as React.CSSProperties}><span>2</span></div>
            <div className="flywheel-node" style={{ '--angle': '144deg' } as React.CSSProperties}><span>3</span></div>
            <div className="flywheel-node" style={{ '--angle': '216deg' } as React.CSSProperties}><span>4</span></div>
            <div className="flywheel-node" style={{ '--angle': '288deg' } as React.CSSProperties}><span>5</span></div>
          </div>
        </div>
      </div>

      {/* Slide 10: Why Now */}
      <div className="deck-slide">
        <span className="deck-label">Why Now</span>
        <h2>The infrastructure moment.</h2>
        <p>Creator commerce is fragmenting across dozens of tools while brands are pulling back from awareness spend and demanding measurable ROI. Gen Z doesn&apos;t trust ads but does trust people. Meanwhile, AI has matured enough to power visual search, product matching, and personalized discovery at scale. Catalog brings these forces together: creator trust on the front end, AI intelligence on the back end, and a commerce model that actually works for everyone involved.</p>
      </div>

      {/* Slide 11: Traction */}
      <div className="deck-slide">
        <span className="deck-label">Traction</span>
        <h2>Early momentum</h2>
        <div className="deck-stats">
          <div className="deck-stat"><span className="deck-stat-num">V1</span><span className="deck-stat-label">Product live and functional</span></div>
          <div className="deck-stat"><span className="deck-stat-num">X</span><span className="deck-stat-label">Active creators</span></div>
          <div className="deck-stat"><span className="deck-stat-num">X</span><span className="deck-stat-label">Looks published</span></div>
          <div className="deck-stat"><span className="deck-stat-num">X</span><span className="deck-stat-label">Brands integrated</span></div>
        </div>
      </div>

      {/* Slide 12: The Ask */}
      <div className="deck-slide">
        <span className="deck-label">The Ask</span>
        <h2>Raising $2.5M on a $12.5M SAFE.</h2>
        <div className="deck-raise-summary">
          <div className="deck-raise-item">
            <span className="deck-raise-num">$2.5M</span>
            <span className="deck-raise-label">Round size</span>
          </div>
          <div className="deck-raise-item">
            <span className="deck-raise-num">$12.5M</span>
            <span className="deck-raise-label">SAFE cap</span>
          </div>
          <div className="deck-raise-item">
            <span className="deck-raise-num">Seed</span>
            <span className="deck-raise-label">Stage</span>
          </div>
        </div>
        <p className="deck-note deck-raise-intro">Capital deployed across three priorities to ignite the flywheel.</p>
        <div className="deck-steps">
          <div className="deck-step"><span className="deck-step-num">01</span><h3>Seed the creator side</h3><p>Onboard the first wave of creators and build the content supply that drives organic demand and distribution.</p></div>
          <div className="deck-step"><span className="deck-step-num">02</span><h3>Deepen the product</h3><p>Build product tagging infrastructure, native mobile app, and creator analytics that make Catalog the default tool.</p></div>
          <div className="deck-step"><span className="deck-step-num">03</span><h3>Bring brands on board</h3><p>Launch the fixed-ROAS model with early brand partners and prove the economics that make the marketplace self-sustaining.</p></div>
        </div>
      </div>

      {/* Slide 13: Final */}
      <div className="deck-slide deck-cover">
        <CatalogLogo className="deck-logo" />
        <p className="deck-subtitle">The human layer of commerce.</p>
        <div className="deck-end-actions">
          <button className="deck-mvp-btn" id="deck-mvp-btn" onClick={onSeeApp}>See the product</button>
          <button className="deck-website-btn" id="deck-website-btn" onClick={onVisitWebsite}>Visit website</button>
          <a className="deck-mvp-btn" href={`${basePath}/trademark.pdf`} target="_blank" rel="noopener noreferrer">Trademark</a>
        </div>
      </div>
    </div>
  );
};

export default DeckViewV8;
