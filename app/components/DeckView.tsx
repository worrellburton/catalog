
import React, { useEffect, useRef } from 'react';
import CatalogLogo from './CatalogLogo';

interface DeckViewProps {
  onSeeApp: () => void;
  onVisitWebsite: () => void;
  isLightMode: boolean;
  onToggleTheme: () => void;
}

const DeckView: React.FC<DeckViewProps> = ({
  onSeeApp,
  onVisitWebsite,
  isLightMode,
  onToggleTheme,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const slides = container.querySelectorAll('.deck-slide');

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
          } else {
            entry.target.classList.remove('visible');
          }
        });
      },
      {
        root: container,
        threshold: 0.15,
      }
    );

    slides.forEach((slide) => observer.observe(slide));

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div className="deck-view active" ref={containerRef}>
      {/* Theme toggle */}
      <button className="deck-theme-toggle" onClick={onToggleTheme}>
        {isLightMode ? (
          // Moon icon for light mode
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
          // Sun icon for dark mode
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
        <p>
          You walked into a store, touched the fabric, asked a friend what they
          thought. Discovery was personal, sensory, and social. Somewhere along
          the way, we lost that. Online shopping became a grid of thumbnails —
          efficient, but soulless. Catalog is bringing that feeling back.
        </p>
      </div>

      {/* Slide 3: The Problem */}
      <div className="deck-slide">
        <span className="deck-label">The Problem</span>
        <h2>Shopping is fragmented. Discovery underperforms.</h2>
        <p>
          Consumers bounce between social media, search engines, and retail
          sites. Creators post content but can&apos;t convert. Brands spend on
          ads that feel like interruptions. The pipeline from inspiration to
          purchase is broken.
        </p>
      </div>

      {/* Slide 4: The Insight */}
      <div className="deck-slide">
        <span className="deck-label">The Insight</span>
        <h2>Taste is a moat.</h2>
        <p>
          People don&apos;t follow creators for discounts — they follow them for
          taste. When someone you trust curates a look, it doesn&apos;t feel
          like an ad. It feels like a recommendation from a friend. That trust
          converts at 3–5x the rate of traditional advertising.
        </p>
      </div>

      {/* Slide 5: The Solution */}
      <div className="deck-slide">
        <span className="deck-label">The Solution</span>
        <h2>The operating system for creator-led commerce.</h2>
        <p>
          Catalog gives creators the tools to build shoppable lookbooks — short
          video clips paired with the products they&apos;re wearing. Shoppers
          browse, discover, and buy in a single fluid experience. Brands get
          authentic, performance-driven distribution.
        </p>
      </div>

      {/* Slide 6: Three-Sided Value */}
      <div className="deck-slide">
        <span className="deck-label">Three-Sided Value</span>
        <h2>Everyone wins.</h2>
        <div className="deck-steps">
          <div className="deck-step">
            <h3>For Shoppers</h3>
            <p>
              A visual, engaging way to discover products through people they
              trust. No ads, no noise — just curated style.
            </p>
          </div>
          <div className="deck-step">
            <h3>For Creators</h3>
            <p>
              A dedicated storefront for their taste. Higher commissions, better
              tools, and real ownership of their audience.
            </p>
          </div>
          <div className="deck-step">
            <h3>For Brands</h3>
            <p>
              Authentic distribution through trusted voices. Guaranteed ROAS
              and zero wasted spend.
            </p>
          </div>
        </div>
      </div>

      {/* Slide 7: How It Works */}
      <div className="deck-slide">
        <span className="deck-label">How It Works</span>
        <h2>Create. Curate. Convert.</h2>
        <div className="deck-steps">
          <div className="deck-step">
            <h3>1. Create</h3>
            <p>
              Creators film short video clips showcasing their looks — what
              they&apos;re wearing, how they style it, why they love it.
            </p>
          </div>
          <div className="deck-step">
            <h3>2. Curate</h3>
            <p>
              Each look is tagged with shoppable products. Creators build a
              living lookbook that reflects their personal style.
            </p>
          </div>
          <div className="deck-step">
            <h3>3. Convert</h3>
            <p>
              Shoppers browse, tap, and buy — all within the Catalog
              experience. Every purchase is tracked and attributed.
            </p>
          </div>
        </div>
      </div>

      {/* Slide 8: Market Opportunity */}
      <div className="deck-slide">
        <span className="deck-label">Market Opportunity</span>
        <h2>$1.2T and growing fast.</h2>
        <div className="deck-stats">
          <div className="deck-stat">
            <span className="deck-stat-value">$1.2T</span>
            <span className="deck-stat-desc">Global social commerce</span>
            <span className="deck-stat-growth">+31% CAGR</span>
            <div
              className="deck-growth-line"
              style={{ '--grow-width': '90%' } as React.CSSProperties}
            />
          </div>
          <div className="deck-stat">
            <span className="deck-stat-value">$250B</span>
            <span className="deck-stat-desc">Creator-driven commerce</span>
            <span className="deck-stat-growth">+22% CAGR</span>
            <div
              className="deck-growth-line"
              style={{ '--grow-width': '65%' } as React.CSSProperties}
            />
          </div>
          <div className="deck-stat">
            <span className="deck-stat-value">82%</span>
            <span className="deck-stat-desc">Consumers trust creators</span>
            <span className="deck-stat-growth">+12% YoY</span>
            <div
              className="deck-growth-line"
              style={{ '--grow-width': '45%' } as React.CSSProperties}
            />
          </div>
        </div>
      </div>

      {/* Slide 9: The Math */}
      <div className="deck-slide">
        <span className="deck-label">The Math</span>
        <h2>Why this beats traditional affiliate.</h2>
        <table className="deck-table">
          <thead>
            <tr>
              <th></th>
              <th>Traditional Affiliate</th>
              <th>Catalog</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Commission rate</td>
              <td>10%</td>
              <td>12–15%</td>
            </tr>
            <tr>
              <td>Creator gets</td>
              <td>8%</td>
              <td>10–12%</td>
            </tr>
            <tr>
              <td>Platform takes</td>
              <td>2%</td>
              <td>2–3%</td>
            </tr>
            <tr>
              <td>ROAS guarantee</td>
              <td>None</td>
              <td>
                <span className="deck-guaranteed">
                  <span className="deck-green-ring" />
                  Guaranteed
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Slide 10: Final */}
      <div className="deck-slide deck-final">
        <h2>Ready to see it in action?</h2>
        <div className="deck-final-buttons">
          <button id="deck-mvp-btn" className="deck-btn" onClick={onSeeApp}>
            See the MVP
          </button>
          <button
            id="deck-website-btn"
            className="deck-btn deck-btn-secondary"
            onClick={onVisitWebsite}
          >
            Visit website
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeckView;
