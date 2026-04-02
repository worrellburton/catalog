
import React, { useEffect, useRef } from 'react';
import CatalogLogo from './CatalogLogo';

interface DeckViewProps {
  onSeeApp: () => void;
  onVisitWebsite: () => void;
  onBack: () => void;
  isLightMode: boolean;
  onToggleTheme: () => void;
}

const DeckView: React.FC<DeckViewProps> = ({
  onSeeApp,
  onVisitWebsite,
  onBack,
  isLightMode,
  onToggleTheme,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const slides = container.querySelectorAll('.deck-slide');

    const hash = window.location.hash.replace('#', '');
    const slideMatch = hash.match(/^deck\/v5\/(\d+)$/);
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
              window.history.replaceState(null, '', `#deck/v5/${idx + 1}`);
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
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        ) : (
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
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
        <p className="deck-subtitle">Investor Deck V.5 for Alex and Dan</p>
      </div>

      {/* Slide 2: Intro — Old Catalogs Meet AI */}
      <div className="deck-slide deck-slide-intro-split">
        <div className="deck-intro-left">
          <span className="deck-label">Intro</span>
          <h2>The catalog is back.</h2>
          <p>For decades, catalogs were how America discovered what to buy. Sears, J.Crew, IKEA — pages you dog-eared, circled, tore out. It was curated, visual, personal. Then e-commerce killed the catalog and replaced it with search bars and infinite scroll.</p>
          <p>We&apos;re building the next generation. Where creators are the editors, video is the format, and AI makes every catalog personal. Same magic. New medium.</p>
        </div>
        <div className="deck-intro-right">
          <div className="catalog-evolution">
            {/* Old catalog */}
            <div className="evo-old">
              <div className="evo-catalog-old">
                <div className="evo-catalog-cover">
                  <div className="evo-catalog-stripe" />
                  <span className="evo-catalog-title">SPRING<br/>CATALOG</span>
                  <span className="evo-catalog-year">&apos;92</span>
                  <div className="evo-catalog-badge">512 pages</div>
                </div>
                <div className="evo-catalog-pages">
                  <div className="evo-page" style={{ '--offset': '3px' } as React.CSSProperties} />
                  <div className="evo-page" style={{ '--offset': '6px' } as React.CSSProperties} />
                  <div className="evo-page" style={{ '--offset': '9px' } as React.CSSProperties} />
                </div>
              </div>
              <span className="evo-label">Then</span>
            </div>

            {/* Arrow / transformation */}
            <div className="evo-arrow">
              <div className="evo-arrow-line" />
              <div className="evo-spark">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" />
                </svg>
                <span>AI</span>
              </div>
              <div className="evo-arrow-line" />
            </div>

            {/* New catalog */}
            <div className="evo-new">
              <div className="evo-phone">
                <div className="evo-phone-notch" />
                <div className="evo-phone-screen">
                  <div className="evo-phone-grid">
                    <div className="evo-phone-card evo-card-1" />
                    <div className="evo-phone-card evo-card-2" />
                    <div className="evo-phone-card evo-card-3" />
                    <div className="evo-phone-card evo-card-4" />
                  </div>
                  <div className="evo-phone-bar">
                    <div className="evo-phone-avatar" />
                    <div className="evo-phone-text" />
                  </div>
                </div>
              </div>
              <span className="evo-label">Now</span>
            </div>
          </div>
        </div>
      </div>

      {/* Slide 3: The Problem */}
      <div className="deck-slide">
        <span className="deck-label">The Problem</span>
        <h2>Shopping is fragmented.<br />Discovery underperforms.</h2>
        <p>The internet has endless products but no trusted curation. Consumers scroll through undifferentiated storefronts. Creators scatter affiliate links across platforms with no ownership. Brands pay for vague awareness with no measurable return. The discovery layer between people and products simply doesn&apos;t exist yet.</p>
      </div>

      {/* Slide 4: The Insight */}
      <div className="deck-slide">
        <span className="deck-label">The Insight</span>
        <h2>Taste is a moat.</h2>
        <p>People already shop from creators on Instagram, TikTok, LTK, ShopMy, and Amazon storefronts. They don&apos;t want search. They want curation. In the world of AI, the next commerce platform won&apos;t be a competitor to these. It will be a layer on top. Organized by look, by creator, by taste.</p>
      </div>

      {/* Slide 5: The Solution */}
      <div className="deck-slide">
        <span className="deck-label">The Solution</span>
        <h2>The operating system for creator-led commerce.</h2>
        <p>Catalog is a creator-powered shopping platform where people discover products through curated looks, collections, and creator taste. Every piece of content is authentic to the creator who made it. Every item is tagged and purchasable. Every creator builds their own catalog, a living storefront of their personal style.</p>
      </div>

      {/* Slide 6: Three-Sided Value */}
      <div className="deck-slide">
        <span className="deck-label">Three-Sided Value</span>
        <h2>Everyone wins.</h2>
        <div className="value-matrix">
          {/* Header row */}
          <div className="value-matrix-header">
            <div className="value-matrix-corner" />
            <div className="value-matrix-col-label value-before-label">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              Today
            </div>
            <div className="value-matrix-col-label value-after-label">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              With Catalog
            </div>
          </div>
          {/* Shoppers row */}
          <div className="value-matrix-row">
            <div className="value-matrix-persona">
              <svg className="value-persona-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
              <span>Shoppers</span>
            </div>
            <div className="value-matrix-cell value-before">
              <p>Algorithmic noise, ad fatigue, endless scrolling through undifferentiated storefronts</p>
            </div>
            <div className="value-matrix-cell value-after">
              <p>Curated discovery driven by people they trust. Browse by creator, occasion, aesthetic</p>
            </div>
          </div>
          {/* Creators row */}
          <div className="value-matrix-row">
            <div className="value-matrix-persona">
              <svg className="value-persona-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              <span>Creators</span>
            </div>
            <div className="value-matrix-cell value-before">
              <p>Scattered affiliate links, no audience ownership, content disappears in the feed</p>
            </div>
            <div className="value-matrix-cell value-after">
              <p>A dedicated storefront for their taste. Higher commissions, real audience ownership</p>
            </div>
          </div>
          {/* Brands row */}
          <div className="value-matrix-row">
            <div className="value-matrix-persona">
              <svg className="value-persona-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 7V5a4 4 0 0 0-8 0v2"/></svg>
              <span>Brands</span>
            </div>
            <div className="value-matrix-cell value-before">
              <p>Vague awareness spend, unpredictable ROAS, last-click attribution</p>
            </div>
            <div className="value-matrix-cell value-after">
              <p>Guaranteed ROAS, full-funnel attribution, authentic distribution through trusted voices</p>
            </div>
          </div>
        </div>
      </div>

      {/* Slide 7: How It Works */}
      <div className="deck-slide">
        <span className="deck-label">How It Works</span>
        <h2>Create. Curate. Convert.</h2>
        <div className="deck-steps">
          <div className="deck-step">
            <span className="deck-step-num">01</span>
            <h3>Creators film looks</h3>
            <p>Short video clips with tagged products from any brand.</p>
          </div>
          <div className="deck-step">
            <span className="deck-step-num">02</span>
            <h3>Consumers discover</h3>
            <p>Browse video looks by gender, style, creator. Find what resonates.</p>
          </div>
          <div className="deck-step">
            <span className="deck-step-num">03</span>
            <h3>Shop in context</h3>
            <p>Tap any product to buy. The look is the storefront.</p>
          </div>
        </div>
      </div>

      {/* Slide 8: Market Opportunity */}
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
        <div className="deck-stats deck-stats-row2">
          <div className="deck-stat">
            <span className="deck-stat-num">10x</span>
            <span className="deck-stat-label">Short-form video conversion vs static display ads</span>
            <div className="stat-growth">
              <div className="growth-line" style={{ '--grow-width': '80%' } as React.CSSProperties} />
              <span className="growth-rate">+40% YoY</span>
            </div>
          </div>
          <div className="deck-stat">
            <span className="deck-stat-num">92min</span>
            <span className="deck-stat-label">Daily time on creator content vs 12min on shopping apps</span>
            <div className="stat-growth">
              <div className="growth-line" style={{ '--grow-width': '65%' } as React.CSSProperties} />
              <span className="growth-rate">+24% YoY</span>
            </div>
          </div>
          <div className="deck-stat">
            <span className="deck-stat-num">73%</span>
            <span className="deck-stat-label">Of purchases now start on mobile, not desktop</span>
            <div className="stat-growth">
              <div className="growth-line" style={{ '--grow-width': '55%' } as React.CSSProperties} />
              <span className="growth-rate">+8% YoY</span>
            </div>
          </div>
        </div>
        <p>Catalog sits where creator economy infrastructure meets social commerce. Not competing with Shopify for merchants or Instagram for attention. Building the commerce layer that connects creators directly to purchase.</p>
      </div>

      {/* Slide 9: The Math */}
      <div className="deck-slide">
        <span className="deck-label">The Math</span>
        <h2>Structurally better economics.</h2>
        <p>A creator posts a look featuring a $200 jacket. A shopper buys it through Catalog.</p>
        <table className="math-tbl">
          <thead>
            <tr>
              <th />
              <th className="math-tbl-old">Traditional Affiliate</th>
              <th className="math-tbl-new">Catalog (Fixed ROAS)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="math-tbl-label">Commission rate</td>
              <td className="math-tbl-val-old">10%</td>
              <td className="math-tbl-val-new">20%</td>
            </tr>
            <tr>
              <td className="math-tbl-label">Creator payout</td>
              <td className="math-tbl-val-old">$16 <span className="math-pct">(8%)</span></td>
              <td className="math-tbl-val-new">$20 <span className="math-pct">(10%)</span></td>
            </tr>
            <tr>
              <td className="math-tbl-label">Platform revenue</td>
              <td className="math-tbl-val-old">$4 <span className="math-pct">(2%)</span></td>
              <td className="math-tbl-val-new">$20 <span className="math-pct">(10%)</span></td>
            </tr>
            <tr>
              <td className="math-tbl-label">Brand cost visibility</td>
              <td className="math-tbl-val-old math-tbl-dim">Unpredictable</td>
              <td className="math-tbl-val-new fire-text">Guaranteed 5x ROAS</td>
            </tr>
            <tr>
              <td className="math-tbl-label">Attribution</td>
              <td className="math-tbl-val-old math-tbl-dim">Last-click, lossy</td>
              <td className="math-tbl-val-new">Full-funnel, per-creator</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Slide 10: Flywheel */}
      <div className="deck-slide deck-slide-flywheel-split">
        <div className="flywheel-left">
          <span className="deck-label">Flywheel</span>
          <h2>Build supply first.<br />Demand follows trust.</h2>
          <div className="flywheel-labels">
            <div className="flywheel-label-item"><span className="fl-num">1</span><p>Seed content and creators, build supply</p></div>
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

      {/* Slide 11: Why Now */}
      <div className="deck-slide">
        <span className="deck-label">Why Now</span>
        <h2>The timing is right.</h2>
        <p>Creator commerce is fragmenting across dozens of tools. Brands are pulling back from awareness spend and demanding measurable ROI. Gen Z doesn&apos;t trust ads but does trust people. Catalog brings these forces together into a single platform where discovery, trust, and performance reinforce each other.</p>
      </div>

      {/* Slide 12: Traction */}
      <div className="deck-slide">
        <span className="deck-label">Traction</span>
        <h2>Early momentum</h2>
        <div className="deck-stats">
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

      {/* Slide 13: The Ask */}
      <div className="deck-slide">
        <span className="deck-label">The Ask</span>
        <h2>Raising a seed round</h2>
        <p>We&apos;re raising to scale creator onboarding, build the product tagging infrastructure, and launch the native mobile app. Catalog has the chance to become the operating system for creator-led commerce, and we&apos;re looking for partners who see that future.</p>
      </div>

      {/* Slide 14: Final */}
      <div className="deck-slide deck-cover">
        <CatalogLogo className="deck-logo" />
        <p className="deck-subtitle">Let&apos;s build the future of shopping together.</p>
        <div className="deck-end-actions">
          <button className="deck-mvp-btn" id="deck-mvp-btn" onClick={onSeeApp}>See prototype</button>
          <button className="deck-website-btn" id="deck-website-btn" onClick={onVisitWebsite}>Visit website</button>
          <a className="deck-mvp-btn" href={`${import.meta.env.BASE_URL}trademark.pdf`} target="_blank" rel="noopener noreferrer">Trademark</a>
        </div>
      </div>
    </div>
  );
};

export default DeckView;
