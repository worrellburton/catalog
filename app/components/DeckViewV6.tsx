
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
        <p>Catalog is the platform where every creator&apos;s taste becomes a shoppable experience. Discovery, monetization, and attribution happen in one place, not scattered across a dozen tools. AI powers the infrastructure — visual similarity, personalized recommendations, automated tagging — while creators provide the curation and trust that no algorithm can manufacture on its own.</p>
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
      <div className="deck-slide deck-slide-insight">
        <div className="deck-insight-grid" aria-hidden="true">
          {Array.from({ length: 12 }).map((_, i) => (
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
        <div className="deck-insight-content">
          <span className="deck-label">The Insight</span>
          <h2>Human taste, amplified by AI.</h2>
          <p>We watched creators monetize across Instagram, TikTok, LTK, ShopMy, and Amazon storefronts and saw the same pattern everywhere: audiences follow people for their taste, but the infrastructure to convert that trust into commerce is fragmented, under-monetized, and invisible to brands. The insight isn&apos;t that creators sell. Everyone knows that. The insight is that nobody has built the platform that treats a creator&apos;s curation as the storefront itself — and then uses AI to make that storefront smarter. Vector-based visual similarity surfaces looks that match a shopper&apos;s taste. AI handles the heavy lifting; creators provide the signal.</p>
        </div>
      </div>

      {/* Slide 5: The Solution */}
      <div className="deck-slide deck-slide-solution">
        <div className="deck-solution-layout">
          <div className="deck-solution-text">
            <span className="deck-label">The Solution</span>
            <h2>A living storefront for every creator.</h2>
            <p>Catalog turns creator content into shoppable lookbooks. Short video clips paired with tagged products, browsable by style, occasion, and creator. The product is live and the V1 is built.</p>
          </div>
          <div className="deck-solution-phone">
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
        <div className="deck-flywheel-ring">
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
          <div className="flywheel-labels">
            <div className="flywheel-label-item"><span className="fl-num">1</span><p>Seed creators, build supply</p></div>
            <div className="flywheel-label-item"><span className="fl-num">2</span><p>Creators share, audiences arrive</p></div>
            <div className="flywheel-label-item"><span className="fl-num">3</span><p>Shoppers browse, trust, buy</p></div>
            <div className="flywheel-label-item"><span className="fl-num">4</span><p>Creators earn, invest more</p></div>
            <div className="flywheel-label-item"><span className="fl-num">5</span><p>Shoppers become creators</p></div>
          </div>
        </div>
        <p className="deck-note">We start with creators because supply drives organic demand. Every creator who publishes a look brings their own audience, their own trust, and their own distribution.</p>
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
