// TrailMotion — shared CSS vars + reduced-motion gate.
//
// History: this file used to wrap framer-motion's LazyMotion +
// MotionConfig + motion.div(layoutId) so that taps on a card could
// morph the bounding box into the overlay hero. We pivoted to the
// TrailVideoHost pattern (the same <video> DOM node is appendChild'd
// between slots, which is visually superior anyway because the pixels
// literally don't move), and the layoutId machinery became unused.
//
// framer-motion was still ~50 kB gzipped of dead infrastructure on
// every consumer page. Replacing it with a plain CSS-vars provider
// gets that back. Any caller that ever wants real layout morphing
// should opt in by importing framer-motion locally.

import type { CSSProperties, ReactNode, MouseEvent as ReactMouseEvent } from 'react';
import { forwardRef, useEffect, useState } from 'react';

const TRAIL_DURATION = 0.36;
const TRAIL_EASE_CSS = 'cubic-bezier(0.32, 0.72, 0, 1)';

/** Shared transition descriptor — kept for backwards compat. */
export const trailTransition = {
  type: 'tween' as const,
  ease: [0.32, 0.72, 0, 1] as [number, number, number, number],
  duration: TRAIL_DURATION,
};

/** CSS-var surface other styles read for trail-paced transitions. */
export const TRAIL_CSS_VARS: CSSProperties = {
  // @ts-expect-error CSS custom property
  '--trail-ease': TRAIL_EASE_CSS,
  '--trail-duration': '360ms',
};

interface TrailRootProps { children: ReactNode }

/** Top-level provider. Sets a `data-reduced-motion` attribute on its root
 *  div so descendant CSS can shorten/disable transitions when the user
 *  has reduced-motion turned on. */
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
    <div
      style={TRAIL_CSS_VARS}
      data-reduced-motion={reduced ? 'true' : 'false'}
    >
      {children}
    </div>
  );
}

interface TrailMorphProps {
  id: string;
  className?: string;
  style?: CSSProperties;
  onClick?: (e: ReactMouseEvent<HTMLDivElement>) => void;
  children?: ReactNode;
}

/** Drop-in <div> kept for backwards compat. The layoutId-based morph is
 *  no longer wired (TrailVideoHost handles the no-flicker handoff via
 *  DOM appendChild instead). Callers can still wrap content in this and
 *  apply CSS transitions keyed off `--trail-duration` / `--trail-ease`. */
export const TrailMorph = forwardRef<HTMLDivElement, TrailMorphProps>(
  function TrailMorph({ className, style, onClick, children }, ref) {
    return (
      <div ref={ref} className={className} style={style} onClick={onClick}>
        {children}
      </div>
    );
  }
);
