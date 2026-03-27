
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

      {/* Slide 2: Intro */}
      <div className="deck-slide">
        <span className="deck-label">Intro</span>
        <h2>Shopping used to be an experience.</h2>
        <p>Flipping through a catalog was discovery at its best. Curated, visual, personal. You didn&apos;t search for what you needed. You found what you didn&apos;t know you wanted. That feeling disappeared when commerce moved online. We&apos;re bringing it back, built for creators, designed for how people actually shop today.</p>
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
        <div className="deck-steps">
          <div className="deck-step">
            <span className="deck-step-num">01</span>
            <h3>For Shoppers</h3>
            <p>Curated discovery instead of chaos. Browse by creator, occasion, aesthetic.</p>
          </div>
          <div className="deck-step">
            <span className="deck-step-num">02</span>
            <h3>For Creators</h3>
            <p>Earn from engagement, performance, and referrals. Style becomes an asset, not just content.</p>
          </div>
          <div className="deck-step">
            <span className="deck-step-num">03</span>
            <h3>For Brands</h3>
            <p>Fixed ROAS model. Spend tied to actual return, not impressions.</p>
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
        <h2>$1.2T and growing fast</h2>
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
      </div>

      {/* Slide 9: The Math */}
      <div className="deck-slide">
        <span className="deck-label">The Math</span>
        <h2>Why this beats traditional affiliate.</h2>
        <div className="deck-comparison">
          <div className="deck-compare-col">
            <h3 className="compare-header compare-old">Traditional Affiliate</h3>
            <div className="compare-row">
              <span className="compare-label">Commission rate</span>
              <span className="compare-value">10%</span>
            </div>
            <div className="compare-row">
              <span className="compare-label">Creator gets</span>
              <span className="compare-value">8%</span>
            </div>
            <div className="compare-row">
              <span className="compare-label">Publisher gets</span>
              <span className="compare-value">2%</span>
            </div>
            <div className="compare-row">
              <span className="compare-label">Brand cost visibility</span>
              <span className="compare-value dim">Unpredictable</span>
            </div>
          </div>
          <div className="deck-compare-col">
            <h3 className="compare-header compare-new">Catalog (Fixed ROAS)</h3>
            <div className="compare-row">
              <span className="compare-label">Brand pays</span>
              <span className="compare-value highlight">20% of revenue</span>
            </div>
            <div className="compare-row">
              <span className="compare-label">Creator gets</span>
              <span className="compare-value highlight">10%</span>
            </div>
            <div className="compare-row">
              <span className="compare-label">Catalog gets</span>
              <span className="compare-value highlight">10%</span>
            </div>
            <div className="compare-row">
              <span className="compare-label">Brand cost visibility</span>
              <span className="compare-value guaranteed">
                <span className="guaranteed-ring" />
                Guaranteed
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Slide 10: Flywheel */}
      <div className="deck-slide">
        <span className="deck-label">Flywheel</span>
        <h2>Growth that compounds.</h2>
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
            <div className="flywheel-label-item"><span className="fl-num">1</span><p>Creators share links</p></div>
            <div className="flywheel-label-item"><span className="fl-num">2</span><p>Users sign up via trust</p></div>
            <div className="flywheel-label-item"><span className="fl-num">3</span><p>Creators earn, promote more</p></div>
            <div className="flywheel-label-item"><span className="fl-num">4</span><p>Shoppers browse and stay</p></div>
            <div className="flywheel-label-item"><span className="fl-num">5</span><p>Shoppers become creators</p></div>
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
