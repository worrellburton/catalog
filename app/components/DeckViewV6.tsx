
import React, { useEffect, useRef } from 'react';
import CatalogLogo from './CatalogLogo';

interface DeckViewV6Props {
  onSeeApp: () => void;
  onVisitWebsite: () => void;
  onBack: () => void;
  isLightMode: boolean;
  onToggleTheme: () => void;
}

const DeckViewV6: React.FC<DeckViewV6Props> = ({
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

    // Scroll to slide if hash specifies one
    const hash = window.location.hash.replace('#', '');
    const slideMatch = hash.match(/^deck\/v6\/(\d+)$/);
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
              window.history.replaceState(null, '', `#deck/v6/${idx + 1}`);
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
    <div className="deck-view active" ref={containerRef}>
      {/* Back to deck selector */}
      <button className="deck-back-btn" onClick={onBack} aria-label="Back to decks">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
      {/* Theme toggle */}
      <button className="deck-theme-toggle" onClick={onToggleTheme}>
        {isLightMode ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        )}
      </button>

      {/* Slide 1: Cover */}
      <div className="deck-slide deck-cover">
        <CatalogLogo className="deck-logo" />
        <p className="deck-subtitle">Investor Deck V.6 for Alex and Dan</p>
      </div>

      {/* Slide 2: Intro */}
      <div className="deck-slide">
        <span className="deck-label">Intro</span>
        <h2>Creator content is the new storefront.</h2>
        <p>Catalog is the platform where every creator&apos;s taste becomes a shoppable experience. Discovery, monetization, and attribution happen in one place, not scattered across a dozen tools. In a world where AI is commoditizing search and recommendation, Catalog bets on something algorithms can&apos;t replicate: human curation, personal style, and earned trust.</p>
      </div>

      {/* Slide 3: The Problem */}
      <div className="deck-slide">
        <span className="deck-label">The Problem</span>
        <h2>Three stakeholders.<br />Three broken experiences.</h2>
        <div className="deck-steps">
          <div className="deck-step">
            <span className="deck-step-num">01</span>
            <h3>Consumers</h3>
            <p>Discovery is fragmented across social feeds, search engines, and retail sites. The experience is ad-heavy, algorithm-driven, and impersonal. Finding products you actually want feels like work.</p>
          </div>
          <div className="deck-step">
            <span className="deck-step-num">02</span>
            <h3>Creators</h3>
            <p>Monetization is constrained by traditional affiliate structures that pay single-digit commissions and offer zero audience ownership. Creators drive purchases but don&apos;t capture the value they create.</p>
          </div>
          <div className="deck-step">
            <span className="deck-step-num">03</span>
            <h3>Brands</h3>
            <p>Creator-driven commerce is difficult to measure and hard to attribute cleanly. Brands want commerce outcomes, not just impressions, but current tools make ROI opaque.</p>
          </div>
        </div>
      </div>

      {/* Slide 4: The Insight */}
      <div className="deck-slide">
        <span className="deck-label">The Insight</span>
        <h2>Taste can&apos;t be automated.</h2>
        <p>We watched creators monetize across Instagram, TikTok, LTK, ShopMy, and Amazon storefronts and saw the same pattern everywhere: audiences follow people for their taste, but the infrastructure to convert that trust into commerce is fragmented, under-monetized, and invisible to brands. The insight isn&apos;t that creators sell. Everyone knows that. The insight is that nobody has built the platform that treats a creator&apos;s curation as the storefront itself. In an era of AI-generated everything, human taste is the last authentic signal. Catalog is built on that conviction.</p>
      </div>

      {/* Slide 5: The Solution */}
      <div className="deck-slide">
        <span className="deck-label">The Solution</span>
        <h2>A living storefront for every creator.</h2>
        <p>Catalog turns creator content into shoppable lookbooks. Short video clips paired with tagged products, browsable by style, occasion, and creator. The product is live and the V1 is built.</p>
        <div className="deck-app-preview">
          <div className="deck-app-frame">
            <video
              src={`${basePath}/Untitled.mp4`}
              autoPlay
              loop
              muted
              playsInline
              className="deck-app-video"
            />
          </div>
        </div>
      </div>

      {/* Slide 6: Three-Sided Value */}
      <div className="deck-slide">
        <span className="deck-label">Three-Sided Value</span>
        <h2>When every side wins,<br />the flywheel spins.</h2>
        <div className="deck-steps">
          <div className="deck-step">
            <svg className="deck-step-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><path d="M8 11h6"/><path d="M11 8v6"/></svg>
            <span className="deck-step-num">01</span>
            <h3>For Shoppers</h3>
            <p>An exploratory, curated shopping experience driven by people they trust. No algorithmic noise, no ad fatigue. Discovery that actually feels like discovery.</p>
          </div>
          <div className="deck-step">
            <svg className="deck-step-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            <span className="deck-step-num">02</span>
            <h3>For Creators</h3>
            <p>A new income stream with higher commissions, real audience ownership, and a dedicated storefront for their taste. Style becomes a durable, monetizable asset.</p>
          </div>
          <div className="deck-step">
            <svg className="deck-step-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
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
            <span className="deck-stat-label">Consumers trust creator recs over ads</span>
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
        <div className="deck-comparison">
          <div className="deck-compare-col">
            <h3 className="compare-header compare-old">Traditional Affiliate</h3>
            <div className="compare-row">
              <span className="compare-label">Commission rate</span>
              <span className="compare-value">10%</span>
            </div>
            <div className="compare-row">
              <span className="compare-label">Creator payout</span>
              <span className="compare-value">$16 (8%)</span>
            </div>
            <div className="compare-row">
              <span className="compare-label">Platform revenue</span>
              <span className="compare-value">$4 (2%)</span>
            </div>
            <div className="compare-row">
              <span className="compare-label">Brand cost visibility</span>
              <span className="compare-value dim">Unpredictable</span>
            </div>
            <div className="compare-row">
              <span className="compare-label">Attribution</span>
              <span className="compare-value dim">Last-click, lossy</span>
            </div>
          </div>
          <div className="deck-compare-col">
            <h3 className="compare-header compare-new">Catalog (Fixed ROAS)</h3>
            <div className="compare-row">
              <span className="compare-label">Brand pays</span>
              <span className="compare-value highlight">$40 (20%)</span>
            </div>
            <div className="compare-row">
              <span className="compare-label">Creator payout</span>
              <span className="compare-value highlight">$20 (10%)</span>
            </div>
            <div className="compare-row">
              <span className="compare-label">Catalog revenue</span>
              <span className="compare-value highlight">$20 (10%)</span>
            </div>
            <div className="compare-row">
              <span className="compare-label">Brand cost visibility</span>
              <span className="compare-value guaranteed">
                <span className="guaranteed-ring" />
                Guaranteed 5x ROAS
              </span>
            </div>
            <div className="compare-row">
              <span className="compare-label">Attribution</span>
              <span className="compare-value highlight">Full-funnel, per-creator</span>
            </div>
          </div>
        </div>
      </div>

      {/* Slide 9: Flywheel */}
      <div className="deck-slide">
        <span className="deck-label">Flywheel</span>
        <h2>Build supply first.<br />Demand follows trust.</h2>
        <div className="catalog-flywheel">
          <svg viewBox="0 0 400 400" className="catalog-flywheel-svg">
            {/* Outer arrow ring */}
            <circle cx="200" cy="200" r="158" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="16" />
            {/* Arrow heads on outer ring (clockwise at gap positions) */}
            <polygon points="200,27 210,47 190,47" fill="rgba(255,255,255,0.2)" />
            <polygon points="348,300 332,314 340,290" fill="rgba(255,255,255,0.2)" />
            <polygon points="52,300 60,290 68,314" fill="rgba(255,255,255,0.2)" />

            {/* Segment 1: Top-right — More Creators (teal) */}
            <path d="M 210.5 50.4 A 145 145 0 0 1 330.5 268 L 270.8 228.5 A 85 85 0 0 0 206.1 109.7 Z" fill="rgba(94,186,172,0.55)" />
            {/* Segment 2: Bottom — More Shoppers (coral) */}
            <path d="M 322.7 280 A 145 145 0 0 1 77.3 280 L 115.2 234 A 85 85 0 0 0 284.8 234 Z" fill="rgba(222,148,120,0.55)" />
            {/* Segment 3: Top-left — More Revenue (gold) */}
            <path d="M 69.5 268 A 145 145 0 0 1 189.5 50.4 L 193.9 109.7 A 85 85 0 0 0 129.2 228.5 Z" fill="rgba(224,195,109,0.55)" />

            {/* Segment labels */}
            <text x="280" y="155" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="12" fontWeight="400">More</text>
            <text x="280" y="172" textAnchor="middle" fill="#fff" fontSize="15" fontWeight="700">Creators</text>
            <text x="200" y="298" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="12" fontWeight="400">More</text>
            <text x="200" y="315" textAnchor="middle" fill="#fff" fontSize="15" fontWeight="700">Shoppers</text>
            <text x="120" y="155" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="12" fontWeight="400">More</text>
            <text x="120" y="172" textAnchor="middle" fill="#fff" fontSize="15" fontWeight="700">Revenue</text>

            {/* Center circle */}
            <circle cx="200" cy="200" r="62" fill="rgba(0,0,0,0.6)" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
            {/* Catalog logo in center */}
            <g transform="translate(152, 188) scale(0.092)">
              <path fill="currentColor" d="M1.18012 118C0.000117425 58.115 47.2001 10.03 109.15 10.915C135.11 10.915 156.94 17.995 174.935 32.45C192.93 46.61 204.435 65.195 210.04 87.91H167.56C159.595 64.015 137.47 48.38 109.15 48.38C89.9751 48.38 73.7501 54.87 61.0651 68.145C48.3801 81.42 41.8901 97.94 41.8901 118C41.8901 138.355 48.0851 154.875 60.7701 168.15C73.4551 181.13 89.6801 187.62 109.15 187.62C137.175 187.62 159.89 172.28 168.15 148.68H211.22C206.205 171.395 194.405 189.685 175.82 203.845C157.235 218.005 135.11 225.085 108.855 225.085C45.7251 225.085 1.18012 179.065 1.18012 118ZM215.306 144.55C215.306 120.36 222.091 100.595 235.366 85.255C248.641 69.915 266.046 62.245 287.286 62.245C314.131 62.245 329.176 77.88 334.486 86.14H336.551V66.08H374.901V221.25H337.141V201.485H335.076C331.831 206.205 328.291 209.745 320.916 215.645C313.541 221.545 301.741 225.085 288.466 225.085C266.931 225.085 249.231 217.71 235.661 202.96C222.091 187.915 215.306 168.445 215.306 144.55ZM254.246 143.96C254.246 171.985 271.061 190.57 295.841 190.57C308.231 190.57 318.261 186.145 325.931 177.295C333.601 168.445 337.436 157.235 337.436 143.96C337.436 115.345 320.326 97.055 295.546 97.055C271.061 97.055 254.246 116.525 254.246 143.96ZM409.011 96.76H382.756V66.375H400.161C406.946 66.375 411.371 61.95 411.371 54.575V23.305H447.361V66.08H490.136V96.76H447.361V168.15C447.361 181.425 454.441 189.39 468.601 189.39H489.251V221.25H460.636C427.891 221.25 409.011 202.665 409.011 169.625V96.76ZM492.341 144.55C492.341 120.36 499.126 100.595 512.401 85.255C525.676 69.915 543.081 62.245 564.321 62.245C591.166 62.245 606.211 77.88 611.521 86.14H613.586V66.08H651.936V221.25H614.176V201.485H612.111C608.866 206.205 605.326 209.745 597.951 215.645C590.576 221.545 578.776 225.085 565.501 225.085C543.966 225.085 526.266 217.71 512.696 202.96C499.126 187.915 492.341 168.445 492.341 144.55ZM531.281 143.96C531.281 171.985 548.096 190.57 572.876 190.57C585.266 190.57 595.296 186.145 602.966 177.295C610.636 168.445 614.471 157.235 614.471 143.96C614.471 115.345 597.361 97.055 572.581 97.055C548.096 97.055 531.281 116.525 531.281 143.96ZM670.411 177.59V-1.75834e-05H708.761V174.05C708.761 182.605 713.186 187.62 721.151 187.62H727.346V221.25H712.891C685.751 221.25 670.411 205.025 670.411 177.59ZM723.283 143.665C723.283 97.645 756.913 62.245 805.883 62.245C853.673 61.655 889.368 98.53 888.483 143.665C888.483 189.095 853.968 225.085 805.883 225.085C781.693 225.085 761.928 217.415 746.293 202.075C730.953 186.44 723.283 166.97 723.283 143.665ZM762.223 143.665C762.223 157.235 766.353 168.445 774.318 177.295C782.578 185.85 792.903 190.275 805.588 190.275C818.273 190.275 828.893 185.85 837.153 177.295C845.413 168.445 849.543 157.235 849.543 143.665C849.543 130.095 845.413 118.885 837.153 110.33C828.893 101.48 818.568 97.055 805.883 97.055C793.198 97.055 782.578 101.48 774.318 110.33C766.353 118.885 762.223 130.095 762.223 143.665ZM891.905 143.075C891.905 118.885 898.69 99.415 911.965 84.665C925.535 69.62 942.645 62.245 963.59 62.245C991.32 62.245 1006.07 78.47 1011.08 86.14H1013.44V66.08H1051.5V220.07C1051.5 263.73 1023.18 292.935 972.44 292.935C951.2 292.935 934.385 287.625 921.7 277.3C909.015 266.975 902.23 253.995 900.755 238.655H936.155C938.81 252.815 952.085 261.37 972.44 261.37C999.875 261.37 1013.74 246.915 1013.74 220.07V200.01H1011.38C1006.36 207.09 992.795 223.61 964.77 223.61C943.53 223.61 926.125 216.235 912.26 201.485C898.69 186.735 891.905 167.265 891.905 143.075ZM930.845 143.075C930.845 171.395 947.365 189.095 972.44 189.095C997.515 189.095 1014.03 169.92 1014.03 143.075C1014.03 114.755 996.925 97.055 972.145 97.055C947.365 97.055 930.845 115.935 930.845 143.075Z" />
            </g>
          </svg>
        </div>
        <p className="deck-note">We start with creators because supply drives organic demand. Every creator who publishes a look brings their own audience, their own trust, and their own distribution.</p>
      </div>

      {/* Slide 10: Why Now */}
      <div className="deck-slide">
        <span className="deck-label">Why Now</span>
        <h2>The anti-AI commerce moment.</h2>
        <p>AI is commoditizing search, recommendation, and content creation. Every storefront will soon have AI-generated product descriptions, AI-curated collections, and AI-personalized feeds. In that world, human curation becomes the scarcest signal. Creator commerce is fragmenting across dozens of tools while brands are pulling back from awareness spend and demanding measurable ROI. Gen Z doesn&apos;t trust ads but does trust people. Catalog is built for exactly this moment: a human-first commerce platform in an increasingly automated digital environment.</p>
      </div>

      {/* Slide 11: Traction */}
      <div className="deck-slide">
        <span className="deck-label">Traction</span>
        <h2>Early momentum</h2>
        <div className="deck-stats">
          <div className="deck-stat">
            <span className="deck-stat-num">V1</span>
            <span className="deck-stat-label">Product live and functional</span>
          </div>
          <div className="deck-stat">
            <span className="deck-stat-num">X</span>
            <span className="deck-stat-label">Active creators</span>
          </div>
          <div className="deck-stat">
            <span className="deck-stat-num">X</span>
            <span className="deck-stat-label">Looks published</span>
          </div>
          <div className="deck-stat">
            <span className="deck-stat-num">X</span>
            <span className="deck-stat-label">Brands integrated</span>
          </div>
        </div>
      </div>

      {/* Slide 12: The Ask */}
      <div className="deck-slide">
        <span className="deck-label">The Ask</span>
        <h2>Raising a seed round to ignite the flywheel.</h2>
        <div className="deck-steps">
          <div className="deck-step">
            <span className="deck-step-num">01</span>
            <h3>Seed the creator side</h3>
            <p>Onboard the first wave of creators and build the content supply that drives organic demand and distribution.</p>
          </div>
          <div className="deck-step">
            <span className="deck-step-num">02</span>
            <h3>Deepen the product</h3>
            <p>Build product tagging infrastructure, native mobile app, and creator analytics that make Catalog the default tool.</p>
          </div>
          <div className="deck-step">
            <span className="deck-step-num">03</span>
            <h3>Bring brands on board</h3>
            <p>Launch the fixed-ROAS model with early brand partners and prove the economics that make the marketplace self-sustaining.</p>
          </div>
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

export default DeckViewV6;
