
import React, { useEffect, useRef } from 'react';
import CatalogLogo from './CatalogLogo';
import { prefetchLiveAds } from '~/services/product-creative';
import { primeTrailAssets } from '~/utils/trailPrefetch';

interface LandingPageProps {
  onStartBrowsing: () => void;
}

const LandingPage: React.FC<LandingPageProps> = ({ onStartBrowsing }) => {
  const navRef = useRef<HTMLElement>(null);
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

  // Prime the trail: fetch the live creative list and warm asset caches while
  // the visitor reads the marketing page. By the time they tap "Continue with
  // Google" and land on the feed, the data + first frames are already in
  // memory — no spinner, no shimmer-to-pop, no black gap.
  useEffect(() => {
    let cancelled = false;
    prefetchLiveAds().then(rows => {
      if (cancelled) return;
      primeTrailAssets(rows);
    }).catch(() => { /* offline / no-op */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      if (navRef.current) {
        if (window.scrollY > 50) {
          navRef.current.classList.add('scrolled');
        } else {
          navRef.current.classList.remove('scrolled');
        }
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const revealElements = document.querySelectorAll('.lp-reveal');
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
          }
        });
      },
      { threshold: 0.1 }
    );

    revealElements.forEach((el) => observer.observe(el));

    return () => {
      revealElements.forEach((el) => observer.unobserve(el));
      observer.disconnect();
    };
  }, []);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="landing-page active">
      {/* Nav */}
      <nav className="landing-nav" ref={navRef}>
        <div className="landing-nav-inner">
          <CatalogLogo className="landing-nav-logo" />
          <div className="landing-nav-links">
            <a
              href="#landing-features"
              className="landing-nav-link"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('landing-features');
              }}
            >
              Features
            </a>
            <a
              href="#landing-creators"
              className="landing-nav-link"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('landing-creators');
              }}
            >
              Creators
            </a>
            <a
              href="#landing-brands"
              className="landing-nav-link"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('landing-brands');
              }}
            >
              Brands
            </a>
          </div>
          <button className="landing-nav-cta" onClick={onStartBrowsing}>
            Start shopping
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="landing-hero">
        <div className="landing-hero-bg">
          <div className="hero-gradient-orb hero-orb-1"></div>
          <div className="hero-gradient-orb hero-orb-2"></div>
          <div className="hero-gradient-orb hero-orb-3"></div>
        </div>
        <div className="landing-hero-content">
          <h1 className="landing-hero-title">
            <span className="hero-line hero-line-1">Discover your style.</span>
            <span className="hero-line hero-line-2">Shop creator looks.</span>
          </h1>
          <p className="landing-hero-sub">
            Catalog is a creator-powered shopping platform where you discover
            products through curated looks, collections, and personal taste.
          </p>
          <div className="landing-hero-actions">
            <button className="landing-hero-cta" onClick={onStartBrowsing}>
              Start browsing
            </button>
            <button
              className="landing-hero-secondary"
              onClick={() => scrollToSection('landing-features')}
            >
              See how it works
            </button>
          </div>
        </div>
        <div className="landing-hero-visual">
          <div className="hero-phone-mock">
            <div className="hero-phone-screen">
              <video
                src={`${basePath}/girl2.mp4`}
                autoPlay
                muted
                loop
                playsInline
              />
              <div className="hero-phone-overlay">
                <div className="hero-phone-tag">
                  <span className="hero-tag-brand">Zara</span>
                  <span className="hero-tag-name">Rock Style Flap Shoulder Bag</span>
                  <span className="hero-tag-price">$49</span>
                </div>
              </div>
            </div>
          </div>
          <div className="hero-phone-mock hero-phone-back">
            <div className="hero-phone-screen">
              <video
                src={`${basePath}/guy.mp4`}
                autoPlay
                muted
                loop
                playsInline
              />
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="landing-section landing-features" id="landing-features">
        <div className="landing-section-inner">
          <h2 className="landing-section-title lp-reveal">Shopping, reimagined</h2>
          <p className="landing-section-sub lp-reveal">
            Catalog makes discovery simple, visual, and personal.
          </p>
          <div className="landing-cards">
            <div className="landing-card lp-reveal">
              <div className="landing-card-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                </svg>
              </div>
              <h3>Browse looks</h3>
              <p>Explore a visual grid of video looks. Drag, zoom, and discover styles curated by real creators.</p>
            </div>
            <div className="landing-card lp-reveal">
              <div className="landing-card-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="21" r="1" />
                  <circle cx="20" cy="21" r="1" />
                  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                </svg>
              </div>
              <h3>Shop the look</h3>
              <p>Every item in every video is tagged and purchasable. Tap to buy directly from the brand.</p>
            </div>
            <div className="landing-card lp-reveal">
              <div className="landing-card-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <h3>Follow creators</h3>
              <p>Find creators whose taste matches yours. Browse their full catalog of curated looks.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Creator Section */}
      <section className="landing-section landing-creator-section" id="landing-creators">
        <div className="landing-section-inner landing-split">
          <div className="landing-split-text lp-reveal">
            <span className="landing-label">Creator-powered</span>
            <h2 className="landing-split-title">
              Shop from people<br />you actually trust
            </h2>
            <p className="landing-split-sub">
              Every look is authentic to the creator who styled it. Browse their full catalog, see their aesthetic, and shop with confidence knowing the recommendation is real.
            </p>
            <div className="landing-pills">
              <span className="landing-pill">Video Looks</span>
              <span className="landing-pill">Creator Profiles</span>
              <span className="landing-pill">Curated Collections</span>
            </div>
          </div>
          <div className="landing-split-visual lp-reveal">
            <div className="landing-creator-card">
              <div className="lcc-avatar-wrap">
                <div className="lcc-avatar" style={{ background: '#e8c4a0' }}>L</div>
              </div>
              <h3 className="lcc-name">Lily Wittman</h3>
              <div className="lcc-tags">
                <span>Fashion</span>
                <span>Streetwear</span>
                <span>Accessories</span>
              </div>
              <div className="lcc-stats">
                <div className="lcc-stat">
                  <span className="lcc-stat-label">Looks</span>
                  <span className="lcc-stat-num">24</span>
                </div>
                <div className="lcc-stat">
                  <span className="lcc-stat-label">Products</span>
                  <span className="lcc-stat-num">96</span>
                </div>
                <div className="lcc-stat">
                  <span className="lcc-stat-label">Followers</span>
                  <span className="lcc-stat-num">12.4k</span>
                </div>
              </div>
              <div className="lcc-looks-preview">
                <div className="lcc-look-thumb">
                  <video src={`${basePath}/girl2.mp4`} muted loop playsInline autoPlay />
                </div>
                <div className="lcc-look-thumb">
                  <video src={`${basePath}/girl2.mp4`} muted loop playsInline autoPlay />
                </div>
                <div className="lcc-look-thumb">
                  <video src={`${basePath}/girl2.mp4`} muted loop playsInline autoPlay />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Products Section */}
      <section className="landing-section landing-products-section" id="landing-brands">
        <div className="landing-section-inner landing-split landing-split-reverse">
          <div className="landing-split-text lp-reveal">
            <span className="landing-label">Shoppable</span>
            <h2 className="landing-split-title">
              Every item tagged.<br />Every look shoppable.
            </h2>
            <p className="landing-split-sub">
              See something you love? Tap it. Every product in every video is tagged with brand, name, and price. Shop directly without leaving the experience.
            </p>
            <div className="landing-pills">
              <span className="landing-pill">Direct Purchase</span>
              <span className="landing-pill">Brand Verified</span>
              <span className="landing-pill">Price Transparency</span>
            </div>
          </div>
          <div className="landing-split-visual lp-reveal">
            <div className="landing-product-showcase">
              <div className="lps-video-wrap">
                <video src={`${basePath}/guy.mp4`} muted loop playsInline autoPlay />
              </div>
              <div className="lps-product-list">
                <div className="lps-product">
                  <div className="lps-product-thumb" style={{ background: '#8b9e8b' }}></div>
                  <div className="lps-product-info">
                    <span className="lps-brand">Vince</span>
                    <span className="lps-name">Patchwork Pointelle Shirt</span>
                    <span className="lps-price">$568</span>
                  </div>
                  <svg className="lps-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                </div>
                <div className="lps-product">
                  <div className="lps-product-thumb" style={{ background: '#7ea8c4' }}></div>
                  <div className="lps-product-info">
                    <span className="lps-brand">Suitsupply</span>
                    <span className="lps-name">Light Blue Straight Leg Jeans</span>
                    <span className="lps-price">$199</span>
                  </div>
                  <svg className="lps-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                </div>
                <div className="lps-product">
                  <div className="lps-product-thumb" style={{ background: '#a09088' }}></div>
                  <div className="lps-product-info">
                    <span className="lps-brand">Dior</span>
                    <span className="lps-name">B27 Uptown Low-Top Sneaker</span>
                    <span className="lps-price">$1,200</span>
                  </div>
                  <svg className="lps-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="landing-section landing-cta-section">
        <div className="landing-cta-inner lp-reveal">
          <h2 className="landing-cta-title">
            Ready to discover<br />your next favorite look?
          </h2>
          <p className="landing-cta-sub">
            Join thousands of shoppers already browsing creator-curated looks on Catalog.
          </p>
          <button className="landing-cta-btn" onClick={onStartBrowsing}>
            Start browsing for free
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-brand">
            <CatalogLogo className="landing-footer-logo" />
            <p className="landing-footer-desc">
              The creator-powered shopping platform where discovery meets personal taste.
            </p>
          </div>
          <div className="landing-footer-col">
            <h4>Features</h4>
            <a href="#" onClick={(e) => { e.preventDefault(); scrollToSection('landing-features'); }}>Browse Looks</a>
            <a href="#" onClick={(e) => { e.preventDefault(); scrollToSection('landing-features'); }}>Shop the Look</a>
            <a href="#" onClick={(e) => { e.preventDefault(); scrollToSection('landing-features'); }}>Creator Profiles</a>
            <a href="#">Collections</a>
          </div>
          <div className="landing-footer-col">
            <h4>Company</h4>
            <a href="#">About</a>
            <a href="#">Careers</a>
            <a href="#">Press</a>
          </div>
          <div className="landing-footer-col">
            <h4>Resources</h4>
            <a href="#">Creator Guide</a>
            <a href="#">Brand Partners</a>
            <a href="#">Help Center</a>
          </div>
          <div className="landing-footer-col">
            <h4>Legal</h4>
            <a href="#">Terms of Service</a>
            <a href="#">Privacy Policy</a>
          </div>
        </div>
        <div className="landing-footer-bottom">
          <p>Catalog Inc. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
