'use client';

import React, { useEffect, useRef } from 'react';
import CatalogLogo from './CatalogLogo';

interface LandingPageProps {
  onStartBrowsing: () => void;
}

const LandingPage: React.FC<LandingPageProps> = ({ onStartBrowsing }) => {
  const navRef = useRef<HTMLElement>(null);
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '/catalogwebapp';

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
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('landing-features');
              }}
            >
              Features
            </a>
            <a
              href="#landing-creators"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('landing-creators');
              }}
            >
              Creators
            </a>
            <a
              href="#landing-brands"
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
        <div className="landing-hero-content lp-reveal">
          <h1 className="landing-hero-title">
            <span>Discover your style.</span>
            <span>Shop creator looks.</span>
          </h1>
          <p className="landing-hero-subtitle">
            Catalog is a creator-powered shopping platform where you discover
            products through curated looks, collections, and personal taste.
          </p>
          <div className="landing-hero-buttons">
            <button className="landing-btn-primary" onClick={onStartBrowsing}>
              Start browsing
            </button>
            <button
              className="landing-btn-secondary"
              onClick={() => scrollToSection('landing-features')}
            >
              See how it works
            </button>
          </div>
        </div>
        <div className="landing-hero-visual lp-reveal">
          <div className="landing-phone-mockup">
            <div className="landing-phone-frame">
              <video
                src={`${basePath}/girl.mp4`}
                autoPlay
                muted
                loop
                playsInline
              />
            </div>
          </div>
          <div className="landing-phone-mockup">
            <div className="landing-phone-frame">
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
      <section className="landing-features" id="landing-features">
        <div className="landing-section-header lp-reveal">
          <h2 className="landing-section-title">Shopping, reimagined</h2>
          <p className="landing-section-subtitle">
            Catalog makes discovery simple, visual, and personal.
          </p>
        </div>
        <div className="landing-features-grid">
          <div className="landing-card lp-reveal">
            <div className="landing-card-icon">
              {/* Grid icon */}
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
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
              </svg>
            </div>
            <h3 className="landing-card-title">Browse looks</h3>
            <p className="landing-card-description">
              Scroll through a visual grid of creator-curated looks. Each look
              is a short video showcasing styled outfits and products.
            </p>
          </div>
          <div className="landing-card lp-reveal">
            <div className="landing-card-icon">
              {/* Cart icon */}
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
                <circle cx="9" cy="21" r="1" />
                <circle cx="20" cy="21" r="1" />
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
              </svg>
            </div>
            <h3 className="landing-card-title">Shop the look</h3>
            <p className="landing-card-description">
              Tap any look to see every product featured. Each item is tagged
              with name, brand, and price — ready to shop.
            </p>
          </div>
          <div className="landing-card lp-reveal">
            <div className="landing-card-icon">
              {/* User icon */}
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
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <h3 className="landing-card-title">Follow creators</h3>
            <p className="landing-card-description">
              Follow your favorite creators to see their latest looks. Build a
              feed that reflects your personal style.
            </p>
          </div>
        </div>
      </section>

      {/* Creator Section */}
      <section className="landing-creators" id="landing-creators">
        <div className="landing-creators-content lp-reveal">
          <span className="landing-label">Creator-powered</span>
          <h2 className="landing-section-title">
            Shop from people you actually trust
          </h2>
          <p className="landing-section-subtitle">
            Creators curate looks from brands they love. You get authentic
            recommendations — not ads.
          </p>
        </div>
        <div className="landing-creator-card lp-reveal">
          <div className="landing-creator-info">
            <div className="landing-creator-avatar">LW</div>
            <div className="landing-creator-details">
              <span className="landing-creator-name">Lily Wittman</span>
              <span className="landing-creator-handle">@lily</span>
            </div>
          </div>
          <div className="landing-creator-stats">
            <div className="landing-stat">
              <span className="landing-stat-value">128</span>
              <span className="landing-stat-label">Looks</span>
            </div>
            <div className="landing-stat">
              <span className="landing-stat-value">24.5k</span>
              <span className="landing-stat-label">Followers</span>
            </div>
            <div className="landing-stat">
              <span className="landing-stat-value">512</span>
              <span className="landing-stat-label">Products</span>
            </div>
          </div>
        </div>
      </section>

      {/* Products Section */}
      <section className="landing-products" id="landing-brands">
        <div className="landing-products-content lp-reveal">
          <span className="landing-label">Shoppable</span>
          <h2 className="landing-section-title">
            Every item tagged. Every look shoppable.
          </h2>
          <p className="landing-section-subtitle">
            Each look comes with a full product breakdown — name, brand, and
            price. Tap to shop instantly.
          </p>
        </div>
        <div className="landing-product-showcase lp-reveal">
          <div className="landing-product-video">
            <video
              src={`${basePath}/girl.mp4`}
              autoPlay
              muted
              loop
              playsInline
            />
          </div>
          <div className="landing-product-list">
            <div className="landing-product-item">
              <div className="landing-product-info">
                <span className="landing-product-name">Silk Cami Top</span>
                <span className="landing-product-brand">Everlane</span>
              </div>
              <span className="landing-product-price">$58</span>
            </div>
            <div className="landing-product-item">
              <div className="landing-product-info">
                <span className="landing-product-name">High-Rise Trousers</span>
                <span className="landing-product-brand">COS</span>
              </div>
              <span className="landing-product-price">$89</span>
            </div>
            <div className="landing-product-item">
              <div className="landing-product-info">
                <span className="landing-product-name">Leather Mules</span>
                <span className="landing-product-brand">Mango</span>
              </div>
              <span className="landing-product-price">$75</span>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="landing-cta lp-reveal">
        <h2 className="landing-cta-title">
          Ready to discover your next favorite look?
        </h2>
        <button className="landing-btn-primary" onClick={onStartBrowsing}>
          Start browsing for free
        </button>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-brand">
            <CatalogLogo className="landing-footer-logo" />
            <p className="landing-footer-description">
              A creator-powered shopping platform where you discover products
              through curated looks, collections, and personal taste.
            </p>
          </div>
          <div className="landing-footer-links">
            <div className="landing-footer-column">
              <h4 className="landing-footer-heading">Features</h4>
              <a href="#landing-features" onClick={(e) => { e.preventDefault(); scrollToSection('landing-features'); }}>Browse looks</a>
              <a href="#landing-features" onClick={(e) => { e.preventDefault(); scrollToSection('landing-features'); }}>Shop the look</a>
              <a href="#landing-features" onClick={(e) => { e.preventDefault(); scrollToSection('landing-features'); }}>Follow creators</a>
            </div>
            <div className="landing-footer-column">
              <h4 className="landing-footer-heading">Company</h4>
              <a href="#">About</a>
              <a href="#">Careers</a>
              <a href="#">Blog</a>
            </div>
            <div className="landing-footer-column">
              <h4 className="landing-footer-heading">Resources</h4>
              <a href="#">Help center</a>
              <a href="#">Creator guide</a>
              <a href="#">Brand partners</a>
            </div>
            <div className="landing-footer-column">
              <h4 className="landing-footer-heading">Legal</h4>
              <a href="#">Privacy</a>
              <a href="#">Terms</a>
              <a href="#">Cookies</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
