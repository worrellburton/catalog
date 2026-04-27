// TrailMotion — the single source of truth for trail morph motion.
//
// Wrapping `motion.div` + `layoutId` here (instead of sprinkling layoutId
// strings across components) keeps the spring config + reduced-motion gate
// + LazyMotion bundle-trim choice in one file. If we ever swap motion libs,
// this is the one file to touch.
//
// Subtle by design:
//   • type: 'tween' with the iOS cubic-bezier — no spring overshoot.
//   • 360 ms — short enough to feel decisive, long enough to read.
//   • Disabled entirely under prefers-reduced-motion.

import { LazyMotion, MotionConfig, domAnimation, m } from 'framer-motion';
import type { CSSProperties, ReactNode, MouseEvent as ReactMouseEvent } from 'react';
import { forwardRef, useEffect, useState } from 'react';

// iOS spring curve (Apple's stock animation easing). Reads as "settle into
// place" — no overshoot, no bounce. The Stripe / Linear / Vercel design
// teams converge on this same curve for layout transitions.
const TRAIL_EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];
const TRAIL_DURATION = 0.36; // seconds

const TRAIL_TRANSITION = {
  type: 'tween' as const,
  ease: TRAIL_EASE,
  duration: TRAIL_DURATION,
};

/** Shared transition object — exported for callers that want to compose. */
export const trailTransition = TRAIL_TRANSITION;

/** CSS variable surface so non-motion elements (rail entry, depth blur)
 *  can match the same easing/duration in plain CSS. */
export const TRAIL_CSS_VARS: CSSProperties = {
  // @ts-expect-error CSS custom property
  '--trail-ease': 'cubic-bezier(0.32, 0.72, 0, 1)',
  '--trail-duration': '360ms',
};

interface TrailRootProps { children: ReactNode }

/** Top-level provider. Mount once near the app root. */
export function TrailRoot({ children }: TrailRootProps) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig
        reducedMotion={reduced ? 'always' : 'never'}
        transition={TRAIL_TRANSITION}
      >
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}

interface TrailMorphProps {
  /** Stable id shared by every surface that should hand the box to the
   *  next. Same id on the grid card + the overlay hero = morph. */
  id: string;
  className?: string;
  style?: CSSProperties;
  onClick?: (e: ReactMouseEvent<HTMLDivElement>) => void;
  children?: ReactNode;
}

/** A motion.div with layoutId wired up. Drop-in replacement for a plain div
 *  when you want the box to morph between mount points. */
export const TrailMorph = forwardRef<HTMLDivElement, TrailMorphProps>(
  function TrailMorph({ id, className, style, onClick, children }, ref) {
    return (
      <m.div
        ref={ref}
        layoutId={`trail-${id}`}
        layout="position"
        className={className}
        style={style}
        onClick={onClick}
        // Cap layout-driven scale so wide aspect changes (4:5 card → 9:16
        // hero) don't smear the inner video. The DOM-shared <video>'s own
        // object-fit:cover does the right visual work.
        transition={TRAIL_TRANSITION}
      >
        {children}
      </m.div>
    );
  }
);
