// imports
import { useCallback, useEffect, useState } from 'react';
import { posterRendition } from '~/utils/poster-prefetch';

// types
export interface HeroSlide {
  key: string;
  title: string;
  description?: string | null;
  image: string | null;
  /** Label of the outlined action, e.g. "Open catalog". */
  cta: string;
}

interface DirectoryHeroProps {
  /** "Shop by" line's object — Creator, Brand, Type, Catalog. */
  ghost: string;
  slides: HeroSlide[];
  onOpen: (slide: HeroSlide) => void;
}

// constants
const AUTO_ADVANCE_MS = 7000;

// main logic
/**
 * Landing hero for a section page: the featured items as slides. Left,
 * the "Shop by" eyebrow, the ghosted word, the current item's serif title
 * and description, its action, and the dots + arrows; right, its image
 * with the next slide peeking. Advances on its own until hovered.
 */
export default function DirectoryHero({ ghost, slides, onOpen }: DirectoryHeroProps) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = slides.length;

  const go = useCallback((delta: number) => {
    if (count === 0) return;
    setIndex(i => (i + delta + count) % count);
  }, [count]);

  useEffect(() => { setIndex(0); }, [count]);
  useEffect(() => {
    if (paused || count < 2) return;
    const t = window.setInterval(() => go(1), AUTO_ADVANCE_MS);
    return () => window.clearInterval(t);
  }, [paused, count, go]);

  if (count === 0) {
    return (
      <div className="dir-hero dir-hero--empty" aria-hidden="true">
        <div className="dir-hero-text">
          <span className="dir-hero-shopby">Shop by</span>
          <span className="dir-hero-ghost">{ghost}</span>
        </div>
        <div className="dir-hero-media"><span className="dir-hero-image dir-skeleton" /></div>
      </div>
    );
  }

  const slide = slides[index];
  const next = slides[(index + 1) % count];
  const src = (img: string | null) => (img ? posterRendition(img) ?? img : null);

  return (
    <section
      className="dir-hero"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel"
    >
      <div className="dir-hero-text">
        {count > 1 && (
          <div className="dir-hero-dots" role="tablist" aria-label="Featured">
            {slides.map((s, i) => (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={s.title}
                className={`dir-hero-dot${i === index ? ' is-active' : ''}`}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
        )}
        <span className="dir-hero-shopby">Shop by</span>
        <span className="dir-hero-ghost" aria-hidden="true">{ghost}</span>
        <h2 className="dir-hero-title" key={slide.key}>{slide.title}</h2>
        {slide.description && <p className="dir-hero-desc">{slide.description}</p>}
        <div className="dir-hero-actions">
          <button type="button" className="dir-hero-cta" onClick={() => onOpen(slide)}>{slide.cta}</button>
          {count > 1 && (
            <span className="dir-hero-arrows">
              <button type="button" className="dir-hero-arrow" onClick={() => go(-1)} aria-label="Previous">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
              </button>
              <button type="button" className="dir-hero-arrow" onClick={() => go(1)} aria-label="Next">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
              </button>
            </span>
          )}
        </div>
      </div>
      <div className="dir-hero-media">
        <button type="button" className="dir-hero-image" onClick={() => onOpen(slide)} aria-label={slide.cta}>
          {src(slide.image) ? <img key={slide.key} src={src(slide.image)!} alt="" /> : <span className="dir-hero-image-empty" />}
        </button>
        {count > 1 && (
          <button type="button" className="dir-hero-peek" onClick={() => go(1)} aria-label={`Next: ${next.title}`}>
            {src(next.image) ? <img key={next.key} src={src(next.image)!} alt="" /> : <span className="dir-hero-image-empty" />}
          </button>
        )}
      </div>
    </section>
  );
}
