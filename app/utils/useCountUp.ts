import { useEffect, useRef, useState } from 'react';

/**
 * Animated counter — eases from 0 → target over `durationMs` and stops.
 * Used by the Activity toasts so summary numbers ("+12 new taps") count
 * up instead of snapping into place.
 *
 * Returns the current value to render. Re-runs on target change. Respects
 * prefers-reduced-motion by snapping straight to the target.
 */
export function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') { setValue(target); return; }
    if (target <= 0) { setValue(0); return; }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { setValue(target); return; }
    const startedAt = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startedAt;
      const t = Math.min(1, elapsed / durationMs);
      // easeOutCubic — fast then settles, reads as "tallying up".
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else rafRef.current = null;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [target, durationMs]);

  return value;
}
