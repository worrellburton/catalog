import { useEffect, useState } from 'react';
import type { ClickPayload } from '~/services/present';

/**
 * Renders a short-lived expanding-ring animation at every received
 * click. Used by /present/<slug> as the "tap feedback" channel —
 * any time Robert (or another guest) clicks, the ring blooms at
 * their cursor's position so viewers can see the interaction.
 *
 * Caller drives this by listening for 'click' envelopes and pushing
 * to `clicks` via the imperative pushClick() returned. We keep the
 * state local instead of in the page reducer so animation timers
 * don't trigger root re-renders.
 */
export interface ActiveRipple {
  key: number;
  x: number;
  y: number;
  color: string;
  expiresAt: number;
}

interface PresentClickRipplesProps {
  ripples: ActiveRipple[];
}

export default function PresentClickRipples({ ripples }: PresentClickRipplesProps) {
  if (ripples.length === 0) return null;
  return (
    <div style={layerStyle} aria-hidden="true">
      {ripples.map(r => {
        const px = r.x * (typeof window !== 'undefined' ? window.innerWidth : 1);
        const py = r.y * (typeof window !== 'undefined' ? window.innerHeight : 1);
        return (
          <div
            key={r.key}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              transform: `translate3d(${px}px, ${py}px, 0)`,
              willChange: 'transform',
            }}
          >
            <div style={{
              ...rippleStyle,
              borderColor: r.color,
              animation: 'present-ripple 700ms cubic-bezier(0.22, 1, 0.36, 1) forwards',
            }} />
            <div style={{
              ...rippleDotStyle,
              background: r.color,
              animation: 'present-ripple-dot 700ms cubic-bezier(0.22, 1, 0.36, 1) forwards',
            }} />
          </div>
        );
      })}
      <style>{KEYFRAMES}</style>
    </div>
  );
}

/**
 * Hook that consumes click envelopes and exposes a list of active
 * ripples + a stable push fn. Pushed ripples auto-expire 700 ms
 * after being added.
 */
export function useClickRipples(): {
  ripples: ActiveRipple[];
  pushClick: (payload: ClickPayload) => void;
} {
  const [ripples, setRipples] = useState<ActiveRipple[]>([]);

  // Cleanup expired ripples once per second — keeps the state list
  // bounded without requiring a per-ripple timeout.
  useEffect(() => {
    if (ripples.length === 0) return;
    const id = window.setInterval(() => {
      setRipples(prev => {
        const now = Date.now();
        const next = prev.filter(r => r.expiresAt > now);
        return next.length === prev.length ? prev : next;
      });
    }, 250);
    return () => window.clearInterval(id);
  }, [ripples.length]);

  const pushClick = (payload: ClickPayload) => {
    const key = Date.now() + Math.random();
    setRipples(prev => [
      ...prev,
      {
        key,
        x: payload.x,
        y: payload.y,
        color: payload.color,
        expiresAt: Date.now() + 700,
      },
    ]);
  };

  return { ripples, pushClick };
}

const layerStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  pointerEvents: 'none',
  zIndex: 9998,
};

const rippleStyle: React.CSSProperties = {
  position: 'absolute',
  left: -32,
  top: -32,
  width: 64,
  height: 64,
  borderRadius: '50%',
  border: '2px solid currentColor',
  boxSizing: 'border-box',
  opacity: 0.85,
};

const rippleDotStyle: React.CSSProperties = {
  position: 'absolute',
  left: -6,
  top: -6,
  width: 12,
  height: 12,
  borderRadius: '50%',
  opacity: 0.95,
};

const KEYFRAMES = `
@keyframes present-ripple {
  0%   { transform: scale(0.4); opacity: 0.95; }
  60%  { opacity: 0.55; }
  100% { transform: scale(2.4); opacity: 0; }
}
@keyframes present-ripple-dot {
  0%   { transform: scale(1);   opacity: 0.95; }
  100% { transform: scale(0.2); opacity: 0; }
}
`;
